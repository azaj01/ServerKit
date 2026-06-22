from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from app.services.dns_zone_service import DNSZoneService

dns_zones_bp = Blueprint('dns_zones', __name__)


def get_current_user():
    from flask_jwt_extended import get_jwt_identity
    from app.models.user import User
    return User.query.get(get_jwt_identity())


@dns_zones_bp.route('/', methods=['GET'])
@jwt_required()
def list_zones():
    zones = DNSZoneService.list_zones()
    return jsonify({'zones': [z.to_dict() for z in zones]})


@dns_zones_bp.route('/<int:zone_id>', methods=['GET'])
@jwt_required()
def get_zone(zone_id):
    zone = DNSZoneService.get_zone(zone_id)
    if not zone:
        return jsonify({'error': 'Zone not found'}), 404
    return jsonify(zone.to_dict())


@dns_zones_bp.route('/', methods=['POST'])
@jwt_required()
def create_zone():
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    data = request.get_json()
    try:
        zone = DNSZoneService.create_zone(data)
        return jsonify(zone.to_dict()), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@dns_zones_bp.route('/<int:zone_id>', methods=['DELETE'])
@jwt_required()
def delete_zone(zone_id):
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    if not DNSZoneService.delete_zone(zone_id):
        return jsonify({'error': 'Zone not found'}), 404
    return jsonify({'message': 'Zone deleted'})


# --- Records ---

@dns_zones_bp.route('/<int:zone_id>/records', methods=['GET'])
@jwt_required()
def get_records(zone_id):
    records = DNSZoneService.get_records(zone_id)
    return jsonify({'records': [r.to_dict() for r in records]})


@dns_zones_bp.route('/<int:zone_id>/records', methods=['POST'])
@jwt_required()
def create_record(zone_id):
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    data = request.get_json()
    try:
        record = DNSZoneService.create_record(zone_id, data)
        return jsonify(record.to_dict()), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@dns_zones_bp.route('/records/<int:record_id>', methods=['PUT'])
@jwt_required()
def update_record(record_id):
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    data = request.get_json()
    record = DNSZoneService.update_record(record_id, data)
    if not record:
        return jsonify({'error': 'Record not found'}), 404
    return jsonify(record.to_dict())


@dns_zones_bp.route('/records/<int:record_id>', methods=['DELETE'])
@jwt_required()
def delete_record(record_id):
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    if not DNSZoneService.delete_record(record_id):
        return jsonify({'error': 'Record not found'}), 404
    return jsonify({'message': 'Record deleted'})


# --- Tools ---

@dns_zones_bp.route('/presets', methods=['GET'])
@jwt_required()
def get_presets():
    return jsonify({'presets': DNSZoneService.get_presets()})


@dns_zones_bp.route('/<int:zone_id>/apply-preset', methods=['POST'])
@jwt_required()
def apply_preset(zone_id):
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    data = request.get_json() or {}
    preset_key = data.get('preset')
    variables = data.get('variables', {})
    try:
        records = DNSZoneService.apply_preset(zone_id, preset_key, variables)
        return jsonify({'records': [r.to_dict() for r in records]})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@dns_zones_bp.route('/propagation/<domain>', methods=['GET'])
@jwt_required()
def check_propagation(domain):
    record_type = request.args.get('type', 'A')
    results = DNSZoneService.check_propagation(domain, record_type)
    return jsonify({'domain': domain, 'record_type': record_type, 'results': results})


@dns_zones_bp.route('/<int:zone_id>/mirror', methods=['GET'])
@jwt_required()
def zone_mirror(zone_id):
    """Live provider records for a zone, each tagged serverkit-owned vs external."""
    zone = DNSZoneService.get_zone(zone_id)
    if not zone:
        return jsonify({'error': 'Zone not found'}), 404
    return jsonify(DNSZoneService.list_provider_records(zone))


@dns_zones_bp.route('/<int:zone_id>/export', methods=['GET'])
@jwt_required()
def export_zone(zone_id):
    content = DNSZoneService.export_zone(zone_id)
    if content is None:
        return jsonify({'error': 'Zone not found'}), 404
    return jsonify({'zone_file': content})


@dns_zones_bp.route('/<int:zone_id>/import', methods=['POST'])
@jwt_required()
def import_zone(zone_id):
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    data = request.get_json() or {}
    content = data.get('zone_file', '')
    try:
        records = DNSZoneService.import_zone(zone_id, content)
        return jsonify({'imported': len(records), 'records': [r.to_dict() for r in records]})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
