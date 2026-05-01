"""
AgentRegistry Service

Manages connected agent sessions, routes commands to agents,
and handles agent lifecycle events.
"""

import hmac
import hashlib
import logging
import secrets
import time
import threading

logger = logging.getLogger(__name__)
from datetime import datetime, timedelta
from typing import Dict, Optional, Callable, Any
from dataclasses import dataclass, field
from queue import Queue, Empty

from app import db
from app.models.server import Server, ServerMetrics, ServerCommand, AgentSession


@dataclass
class ConnectedAgent:
    """Represents a connected agent.

    transport='ws'   — long-lived Socket.IO connection. socket_id is the sid.
    transport='poll' — REST long-poll fallback. socket_id is a synthesized
                       "poll-<token>" that uniquely identifies the poll
                       session; outbound_queue holds commands waiting to be
                       handed back on the next /poll request.
    """
    server_id: str
    socket_id: str
    session_token: str
    connected_at: datetime
    last_heartbeat: datetime
    ip_address: str
    agent_version: str
    transport: str = 'ws'
    # Polling-mode only: commands queued for the next /poll response.
    outbound_queue: Queue = field(default_factory=Queue)
    # Pending commands waiting for response
    pending_commands: Dict[str, 'PendingCommand'] = field(default_factory=dict)
    # Feature surfaces the agent reported it can drive (cron, docker,
    # systemd, …). Empty until the agent sends a `capabilities` event;
    # older agents that don't speak the protocol leave this empty so
    # they only show up as default-local in target pickers. The dict is
    # forward-compatible: unknown keys are passed through verbatim.
    capabilities: Dict[str, bool] = field(default_factory=dict)
    platform: Optional[str] = None
    distro: Optional[str] = None
    distro_version: Optional[str] = None
    # Runtimes is name → version detected at agent startup
    # ({"python": "3.11.4", "node": "20.10.0"}). Empty for older
    # agents and for hosts where no runtime probes matched.
    runtimes: Dict[str, str] = field(default_factory=dict)
    # File-access roots advertised when capabilities["files"] is true.
    # Used by the file manager to seed the browse picker. Empty for
    # agents that have file access disabled or don't speak the protocol.
    allowed_paths: list = field(default_factory=list)


@dataclass
class PendingCommand:
    """Represents a command waiting for response"""
    command_id: str
    action: str
    params: dict
    callback: Optional[Callable] = None
    timeout: float = 30.0
    created_at: float = field(default_factory=time.time)
    result_queue: Queue = field(default_factory=Queue)


class AgentRegistry:
    """
    Singleton service that manages all connected agents.

    Responsibilities:
    - Track connected agents by server_id and socket_id
    - Route commands to the correct agent
    - Handle command responses
    - Manage heartbeats and detect disconnections
    - Store metrics received from agents
    """

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True

        # Connected agents by server_id
        self._agents: Dict[str, ConnectedAgent] = {}
        # Socket ID to server ID mapping
        self._socket_to_server: Dict[str, str] = {}
        # Lock for thread safety
        self._lock = threading.Lock()
        # SocketIO instance (set by init_socketio)
        self._socketio = None
        # Flask app, captured so background threads can re-enter the
        # app context. Without this, _handle_agent_timeout (and any
        # other DB-touching code in _check_heartbeats) raises
        # "Working outside of application context" the moment it tries
        # to query — which is why timed-out agents stayed stuck at
        # status=connecting in the DB instead of flipping to offline.
        self._app = None
        # Heartbeat check thread
        self._heartbeat_thread = None
        self._stop_heartbeat = threading.Event()

    def init_socketio(self, socketio):
        """Initialize with SocketIO instance"""
        self._socketio = socketio
        # Capture the current Flask app reference for the background
        # heartbeat thread. current_app is a context-local proxy and
        # only works inside a request/app context, but flask.current_app._get_current_object()
        # gives us the underlying object we can stash.
        from flask import current_app
        try:
            self._app = current_app._get_current_object()
        except RuntimeError:
            # Called outside an app context (e.g. during testing) —
            # heartbeat checker will skip DB operations gracefully.
            self._app = None
        # Start heartbeat checker
        self._start_heartbeat_checker()

    def _start_heartbeat_checker(self):
        """Start background thread to check for dead connections"""
        if self._heartbeat_thread and self._heartbeat_thread.is_alive():
            return

        self._stop_heartbeat.clear()
        self._heartbeat_thread = threading.Thread(
            target=self._check_heartbeats,
            daemon=True
        )
        self._heartbeat_thread.start()

    def _check_heartbeats(self):
        """Check for agents that haven't sent heartbeats"""
        while not self._stop_heartbeat.is_set():
            try:
                now = datetime.utcnow()
                timeout = timedelta(seconds=90)  # 3 missed heartbeats

                with self._lock:
                    dead_agents = []
                    for server_id, agent in self._agents.items():
                        if now - agent.last_heartbeat > timeout:
                            dead_agents.append(server_id)

                # Wrap DB access in an app context — the timeout
                # handler queries Server / AgentSession and commits.
                # In a thread there's no implicit context.
                if dead_agents and self._app is not None:
                    with self._app.app_context():
                        for server_id in dead_agents:
                            self._handle_agent_timeout(server_id)
                elif dead_agents:
                    # No app captured (test environment); just remove
                    # from in-memory registry without touching DB.
                    for server_id in dead_agents:
                        with self._lock:
                            agent = self._agents.pop(server_id, None)
                            if agent:
                                self._socket_to_server.pop(agent.socket_id, None)

            except Exception as e:
                logger.error("Error in heartbeat checker: %s", e)

            self._stop_heartbeat.wait(30)  # Check every 30 seconds

    def _handle_agent_timeout(self, server_id: str):
        """Handle agent that hasn't sent heartbeats"""
        with self._lock:
            agent = self._agents.pop(server_id, None)
            if agent:
                self._socket_to_server.pop(agent.socket_id, None)

        if agent:
            # Update server status in database
            try:
                server = Server.query.get(server_id)
                if server:
                    server.status = 'offline'
                    server.last_error = 'Agent heartbeat timeout'
                    db.session.commit()

                # Mark session as inactive
                session = AgentSession.query.filter_by(
                    server_id=server_id,
                    socket_id=agent.socket_id,
                    is_active=True
                ).first()
                if session:
                    session.is_active = False
                    session.disconnected_at = datetime.utcnow()
                    session.disconnect_reason = 'heartbeat_timeout'
                    db.session.commit()
            except Exception as e:
                logger.exception("Error updating server status")

    # ==================== Connection Management ====================

    def register_agent(
        self,
        server_id: str,
        socket_id: str,
        ip_address: str,
        agent_version: str = None,
        transport: str = 'ws'
    ) -> str:
        """
        Register a newly connected agent.

        transport='ws' is the existing Socket.IO path; 'poll' is the REST
        long-poll fallback used when WS-incompatible tunnels (free-tier
        ngrok, cf quick tunnels) corrupt frames. The two share storage
        and the command-routing path differs only in send_command.

        Returns: session_token
        """
        session_token = secrets.token_urlsafe(32)

        agent = ConnectedAgent(
            server_id=server_id,
            socket_id=socket_id,
            session_token=session_token,
            connected_at=datetime.utcnow(),
            last_heartbeat=datetime.utcnow(),
            ip_address=ip_address,
            agent_version=agent_version or 'unknown',
            transport=transport,
        )

        with self._lock:
            # Remove old connection if exists
            old_agent = self._agents.get(server_id)
            if old_agent:
                self._socket_to_server.pop(old_agent.socket_id, None)

            self._agents[server_id] = agent
            self._socket_to_server[socket_id] = server_id

        # Update database
        try:
            server = Server.query.get(server_id)
            if server:
                server.status = 'online'
                server.last_seen = datetime.utcnow()
                server.last_error = None
                if agent_version:
                    server.agent_version = agent_version
                # Persist the source IP we observed at auth time. Without
                # this the Server.ip_address column stayed NULL forever,
                # which is why the Overview tab showed "IP Address: N/A"
                # even for healthy connected agents.
                if ip_address and ip_address != 'unknown':
                    server.ip_address = ip_address
                db.session.commit()

            # Create session record
            session = AgentSession(
                server_id=server_id,
                session_token=session_token,
                socket_id=socket_id,
                ip_address=ip_address,
                user_agent=f"ServerKit-Agent/{agent_version or 'unknown'}",
                is_active=True
            )
            db.session.add(session)
            db.session.commit()

            # Deliver any queued commands for this server
            try:
                from app.services.agent_fleet_service import fleet_service
                fleet_service.deliver_queued_commands(server_id)
            except Exception as e:
                logger.error("Error delivering queued commands: %s", e)

        except Exception as e:
            logger.exception("Error registering agent")
            db.session.rollback()

        return session_token

    def unregister_agent(self, socket_id: str, reason: str = 'disconnect'):
        """Unregister a disconnected agent"""
        with self._lock:
            server_id = self._socket_to_server.pop(socket_id, None)
            if server_id:
                agent = self._agents.pop(server_id, None)

        if server_id:
            # Update database
            try:
                server = Server.query.get(server_id)
                if server:
                    server.status = 'offline'
                    db.session.commit()

                # Mark session as inactive
                session = AgentSession.query.filter_by(
                    server_id=server_id,
                    socket_id=socket_id,
                    is_active=True
                ).first()
                if session:
                    session.is_active = False
                    session.disconnected_at = datetime.utcnow()
                    session.disconnect_reason = reason
                    db.session.commit()
            except Exception as e:
                logger.exception("Error unregistering agent")
                db.session.rollback()

    def get_agent(self, server_id: str) -> Optional[ConnectedAgent]:
        """Get a connected agent by server ID"""
        with self._lock:
            return self._agents.get(server_id)

    def get_agent_by_socket(self, socket_id: str) -> Optional[ConnectedAgent]:
        """Get a connected agent by socket ID"""
        with self._lock:
            server_id = self._socket_to_server.get(socket_id)
            if server_id:
                return self._agents.get(server_id)
        return None

    def is_agent_connected(self, server_id: str) -> bool:
        """Check if an agent is connected"""
        with self._lock:
            return server_id in self._agents

    def get_connected_servers(self) -> list:
        """Get list of connected server IDs"""
        with self._lock:
            return list(self._agents.keys())

    # ==================== Heartbeat ====================

    def update_heartbeat(self, server_id: str, metrics: dict = None, client_timestamp: int = None):
        """Update agent heartbeat and optionally store metrics"""
        now = datetime.utcnow()
        with self._lock:
            agent = self._agents.get(server_id)
            if agent:
                agent.last_heartbeat = now

        # Calculate heartbeat latency if client sent a timestamp
        latency_ms = None
        if client_timestamp:
            now_ms = int(time.time() * 1000)
            latency_ms = max(0, now_ms - client_timestamp)

        # Update server last_seen
        try:
            server = Server.query.get(server_id)
            if server:
                server.last_seen = now
                if server.status != 'online':
                    server.status = 'online'
                db.session.commit()

            # Update session latency
            if latency_ms is not None:
                session = AgentSession.query.filter_by(
                    server_id=server_id, is_active=True
                ).first()
                if session:
                    session.last_heartbeat = now
                    session.update_latency(latency_ms)
                    db.session.commit()

            # Store metrics if provided
            if metrics:
                self._store_metrics(server_id, metrics)
        except Exception as e:
            logger.exception("Error updating heartbeat")
            db.session.rollback()

    def _store_metrics(self, server_id: str, metrics: dict):
        """Store metrics from heartbeat"""
        try:
            metric = ServerMetrics(
                server_id=server_id,
                cpu_percent=metrics.get('cpu_percent'),
                memory_percent=metrics.get('memory_percent'),
                disk_percent=metrics.get('disk_percent'),
                container_count=metrics.get('container_count'),
                container_running=metrics.get('container_running'),
            )
            db.session.add(metric)
            db.session.commit()
        except Exception as e:
            logger.exception("Error storing metrics")
            db.session.rollback()

    # ==================== Command Routing ====================

    def send_command(
        self,
        server_id: str,
        action: str,
        params: dict = None,
        timeout: float = 30.0,
        user_id: int = None
    ) -> dict:
        """
        Send a command to an agent and wait for response.

        Args:
            server_id: Target server ID
            action: Command action (e.g., 'docker:container:list')
            params: Command parameters
            timeout: Timeout in seconds
            user_id: User ID for audit logging

        Returns:
            dict: Command result with 'success', 'data', 'error'
        """
        agent = self.get_agent(server_id)
        if not agent:
            return {
                'success': False,
                'error': 'Agent not connected',
                'code': 'AGENT_OFFLINE'
            }

        # Check permissions
        server = Server.query.get(server_id)
        if server and not server.has_permission(action):
            return {
                'success': False,
                'error': f'Permission denied for action: {action}',
                'code': 'PERMISSION_DENIED'
            }

        # Create command record
        command_id = secrets.token_urlsafe(16)
        command_record = ServerCommand(
            id=command_id,
            server_id=server_id,
            user_id=user_id,
            command_type=action,
            command_data=params,
            status='pending'
        )

        try:
            db.session.add(command_record)
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            return {
                'success': False,
                'error': f'Failed to create command record: {e}',
                'code': 'DB_ERROR'
            }

        # Create pending command
        pending = PendingCommand(
            command_id=command_id,
            action=action,
            params=params or {},
            timeout=timeout
        )

        with self._lock:
            agent.pending_commands[command_id] = pending

        # Hand the command to the agent. WS agents get an immediate emit;
        # polling agents get the command pushed onto their outbound queue
        # where it sits until the next /api/v1/agent/poll request drains
        # it. Both paths block below on pending.result_queue.get(timeout).
        command_payload = {
            'type': 'command',
            'id': command_id,
            'action': action,
            'params': params or {},
            'timeout': int(timeout * 1000)
        }
        try:
            if agent.transport == 'poll':
                agent.outbound_queue.put(command_payload)
            else:
                self._socketio.emit(
                    'command',
                    command_payload,
                    room=agent.socket_id,
                    namespace='/agent'
                )

            # Update command status
            command_record.status = 'running'
            command_record.started_at = datetime.utcnow()
            db.session.commit()

        except Exception as e:
            with self._lock:
                agent.pending_commands.pop(command_id, None)
            command_record.status = 'failed'
            command_record.error = str(e)
            db.session.commit()
            return {
                'success': False,
                'error': f'Failed to send command: {e}',
                'code': 'SEND_ERROR'
            }

        # Wait for response
        try:
            result = pending.result_queue.get(timeout=timeout)
        except Empty:
            result = {
                'success': False,
                'error': 'Command timeout',
                'code': 'TIMEOUT'
            }

        # Clean up
        with self._lock:
            agent.pending_commands.pop(command_id, None)

        # Update command record
        try:
            command_record.status = 'completed' if result.get('success') else 'failed'
            command_record.completed_at = datetime.utcnow()
            command_record.result = result.get('data')
            command_record.error = result.get('error')
            db.session.commit()
        except Exception as e:
            db.session.rollback()

        return result

    # ==================== Polling Transport Support ====================

    def get_agent_by_token(self, session_token: str) -> Optional[ConnectedAgent]:
        """Look up an agent by its session token. Used by polling endpoints
        which don't have a socket id and authenticate every request via
        the token instead."""
        if not session_token:
            return None
        with self._lock:
            for agent in self._agents.values():
                if agent.session_token == session_token:
                    return agent
        return None

    def drain_outbound(self, agent: 'ConnectedAgent', max_wait_s: float, max_items: int = 16):
        """Pull queued commands for a polling-mode agent. Long-polls up to
        max_wait_s for the FIRST command, then drains anything else
        already queued without further blocking. Returns a list (possibly
        empty if max_wait_s elapsed with no work)."""
        items = []
        try:
            first = agent.outbound_queue.get(timeout=max_wait_s)
            items.append(first)
        except Empty:
            return items
        # Drain anything else already queued, no blocking
        for _ in range(max_items - 1):
            try:
                items.append(agent.outbound_queue.get_nowait())
            except Empty:
                break
        return items

    def deliver_result_by_token(self, session_token: str, result: dict) -> bool:
        """Polling-side equivalent of handle_command_result. Returns True
        when the result was matched to a pending command and delivered."""
        agent = self.get_agent_by_token(session_token)
        if not agent:
            return False
        command_id = result.get('command_id')
        if not command_id or not isinstance(command_id, str) or len(command_id) > 64:
            return False
        with self._lock:
            pending = agent.pending_commands.get(command_id)
        if not pending:
            return False
        pending.result_queue.put({
            'success': result.get('success', False),
            'data': result.get('data'),
            'error': result.get('error'),
            'duration': result.get('duration')
        })
        return True

    def unregister_by_token(self, session_token: str, reason: str = 'disconnect'):
        """Polling-side equivalent of unregister_agent — used when the
        agent posts /disconnect or when the polling session times out."""
        agent = self.get_agent_by_token(session_token)
        if not agent:
            return
        self.unregister_agent(agent.socket_id, reason=reason)

    # ==================== Command Result Handling (WS) ====================

    def handle_command_result(self, socket_id: str, result: dict):
        """Handle command result from agent"""
        agent = self.get_agent_by_socket(socket_id)
        if not agent:
            logger.warning(f"Command result from unknown socket: {socket_id}")
            return

        command_id = result.get('command_id')
        if not command_id:
            logger.warning(f"Command result missing command_id from agent: {agent.server_id}")
            return

        # Validate command_id format to prevent injection
        if not isinstance(command_id, str) or len(command_id) > 64:
            logger.warning(f"Invalid command_id format from agent: {agent.server_id}")
            return

        with self._lock:
            pending = agent.pending_commands.get(command_id)

        if pending:
            pending.result_queue.put({
                'success': result.get('success', False),
                'data': result.get('data'),
                'error': result.get('error'),
                'duration': result.get('duration')
            })

    # ==================== Authentication ====================

    def verify_agent_auth(
        self,
        agent_id: str,
        api_key_prefix: str,
        signature: str,
        timestamp: int,
        nonce: str = None,
        ip_address: str = None
    ) -> Optional[Server]:
        """
        Verify agent authentication with full signature and replay protection.

        Args:
            agent_id: Agent's unique ID
            api_key_prefix: First 12 chars of API key
            signature: HMAC-SHA256 signature
            timestamp: Unix timestamp in milliseconds
            nonce: Unique nonce for replay protection (optional but recommended)
            ip_address: Source IP address for anomaly tracking

        Returns:
            Server if authenticated, None otherwise
        """
        from app.services.nonce_service import nonce_service
        from app.services.anomaly_detection_service import anomaly_detection_service

        # Check timestamp (allow 5 minute window)
        now = int(time.time() * 1000)
        if abs(now - timestamp) > 60000:  # 60 seconds
            if ip_address:
                anomaly_detection_service.track_auth_attempt(None, False, ip_address)
            return None

        # Find server by agent_id
        server = Server.query.filter_by(agent_id=agent_id).first()
        if not server:
            if ip_address:
                anomaly_detection_service.track_auth_attempt(None, False, ip_address)
            return None

        # Verify API key prefix matches (support both active and pending during rotation)
        prefix_matches = server.api_key_prefix == api_key_prefix
        pending_prefix_matches = (
            server.api_key_pending_prefix == api_key_prefix and
            server.api_key_rotation_expires and
            datetime.utcnow() <= server.api_key_rotation_expires
        )

        if not prefix_matches and not pending_prefix_matches:
            anomaly_detection_service.track_auth_attempt(server.id, False, ip_address)
            return None

        # Check nonce for replay protection (if nonce provided)
        if nonce:
            if not nonce_service.check_and_record(server.id, nonce):
                # Replay attack detected!
                anomaly_detection_service.track_replay_attack(server.id, ip_address, nonce)
                return None

        # Verify HMAC signature if we have the encrypted secret
        api_secret = server.get_api_secret()
        if api_secret:
            # Construct the message that was signed
            # Format: agent_id:timestamp:nonce (nonce is optional for backward compatibility)
            if nonce:
                message = f"{agent_id}:{timestamp}:{nonce}"
            else:
                message = f"{agent_id}:{timestamp}"

            # Calculate expected signature
            expected_signature = hmac.new(
                api_secret.encode(),
                message.encode(),
                hashlib.sha256
            ).hexdigest()

            if not hmac.compare_digest(signature, expected_signature):
                anomaly_detection_service.track_auth_attempt(server.id, False, ip_address)
                return None

        # Authentication successful
        if ip_address:
            anomaly_detection_service.track_auth_attempt(server.id, True, ip_address)

        # TODO: Implement per-message session token validation. Currently, the session
        # token is issued at auth time but not verified on each subsequent message.
        # Full session-per-message validation requires protocol changes on both the
        # agent (Go) and backend sides.

        return server

    # ==================== Capabilities ====================

    def update_capabilities(self, server_id: str, payload: dict):
        """Stash the capability map an agent reported on connect.

        payload shape mirrors protocol.CapabilitiesMessage minus the
        envelope:

            {
              "capabilities": {"docker": true, "cron": true, ...},
              "platform": "linux",
              "distro": "ubuntu",
              "distro_version": "22.04"
            }

        Stored only on the in-memory ConnectedAgent — capabilities are
        re-shipped on every reconnect, so persisting across panel
        restarts isn't necessary. An older agent that never sends this
        message simply has an empty capabilities dict and never shows
        up in feature-gated target pickers.
        """
        if not isinstance(payload, dict):
            return
        caps = payload.get('capabilities') or {}
        # Coerce values to bool — agents are trusted but defensive
        # casting protects the API consumer (UI) from malformed types.
        clean_caps = {str(k): bool(v) for k, v in caps.items() if isinstance(k, str)}

        # Coerce runtimes the same way — agents are trusted but we
        # don't want a malformed payload to crash the consumer.
        raw_runtimes = payload.get('runtimes') or {}
        clean_runtimes: Dict[str, str] = {}
        if isinstance(raw_runtimes, dict):
            for k, v in raw_runtimes.items():
                if isinstance(k, str) and isinstance(v, (str, type(None))):
                    clean_runtimes[k] = v or ''

        # Allowed paths — only meaningful when capabilities["files"] is
        # true; coerce to list of strings either way for safety.
        raw_paths = payload.get('allowed_paths') or []
        clean_paths = [str(p) for p in raw_paths if isinstance(p, str) and p.strip()] \
            if isinstance(raw_paths, list) else []

        # Newer payloads carry sudo mode + runtime managers + systemd_json.
        # Coerce defensively — older agents won't include these keys.
        sudo_mode = payload.get('sudo')
        if not isinstance(sudo_mode, str):
            sudo_mode = ''
        raw_managers = payload.get('runtime_managers') or {}
        clean_managers: Dict[str, str] = {}
        if isinstance(raw_managers, dict):
            for k, v in raw_managers.items():
                if isinstance(k, str) and isinstance(v, (str, type(None))):
                    clean_managers[k] = v or ''
        systemd_json = bool(payload.get('systemd_json'))

        with self._lock:
            agent = self._agents.get(server_id)
            if not agent:
                return
            agent.capabilities = clean_caps
            agent.platform = payload.get('platform') or None
            agent.distro = payload.get('distro') or None
            agent.distro_version = payload.get('distro_version') or None
            agent.runtimes = clean_runtimes
            agent.allowed_paths = clean_paths

        # Persist a snapshot to the Server row so the Overview tab can
        # render even when the agent is offline. Wrapped in a try/except
        # so a transient DB hiccup doesn't drop the in-memory update —
        # the cache is best-effort, the live value above is the source
        # of truth while the agent is connected.
        try:
            from app import db
            from app.models.server import Server
            server = Server.query.get(server_id)
            if server is not None:
                server.cached_capabilities = clean_caps
                server.cached_runtimes = clean_runtimes
                server.cached_runtime_managers = clean_managers
                server.cached_allowed_paths = clean_paths
                server.cached_sudo = sudo_mode
                server.cached_systemd_json = systemd_json
                server.capabilities_at = datetime.utcnow()
                if payload.get('platform'):
                    server.platform = payload.get('platform')
                if payload.get('distro'):
                    server.os_version = payload.get('distro_version') or server.os_version
                db.session.commit()
        except Exception as exc:
            # Don't let cache persistence failures break live updates.
            logger.warning("Failed to persist capability snapshot for %s: %s", server_id, exc)

        logger.info(
            "Capabilities updated for server %s: %s",
            server_id,
            sorted(k for k, v in clean_caps.items() if v),
        )

    def get_capabilities(self, server_id: str) -> Optional[Dict[str, bool]]:
        """Return the capability map for a connected agent, or None if
        the agent is not connected. Returns an empty dict if the agent
        is connected but hasn't (yet) reported capabilities — that's a
        valid state for older agents."""
        with self._lock:
            agent = self._agents.get(server_id)
            if not agent:
                return None
            return dict(agent.capabilities)

    def has_capability(self, server_id: str, feature: str) -> bool:
        """Convenience: is the given feature reported as available?"""
        caps = self.get_capabilities(server_id)
        if not caps:
            return False
        return bool(caps.get(feature))

    def get_allowed_paths(self, server_id: str) -> list:
        """File roots the agent advertised on connect, empty if not advertised."""
        with self._lock:
            agent = self._agents.get(server_id)
            if not agent:
                return []
            return list(agent.allowed_paths)

    # ==================== System Info ====================

    def update_system_info(self, server_id: str, info: dict):
        """Update server system information from agent"""
        try:
            server = Server.query.get(server_id)
            if server:
                server.hostname = info.get('hostname', server.hostname)
                server.os_type = info.get('os', server.os_type)
                server.os_version = info.get('os_version', server.os_version)
                server.platform = info.get('platform', server.platform)
                server.architecture = info.get('architecture', server.architecture)
                server.cpu_cores = info.get('cpu_cores', server.cpu_cores)
                server.cpu_model = info.get('cpu_model', server.cpu_model)
                server.total_memory = info.get('total_memory', server.total_memory)
                server.total_disk = info.get('total_disk', server.total_disk)
                server.docker_version = info.get('docker_version', server.docker_version)
                server.agent_version = info.get('agent_version', server.agent_version)
                db.session.commit()
        except Exception as e:
            logger.exception("Error updating system info")
            db.session.rollback()


# Global instance
agent_registry = AgentRegistry()
