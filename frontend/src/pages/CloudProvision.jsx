import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import Spinner from '../components/Spinner';
import ConfirmDialog from '../components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const CloudProvision = () => {
    const toast = useToast();
    const { user } = useAuth();
    const [providers, setProviders] = useState([]);
    const [servers, setServers] = useState([]);
    const [costs, setCosts] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showCreateProvider, setShowCreateProvider] = useState(false);
    const [showCreateServer, setShowCreateServer] = useState(false);
    const [providerOptions, setProviderOptions] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null);

    const [providerForm, setProviderForm] = useState({ name: '', provider_type: 'digitalocean', api_key: '' });
    const [serverForm, setServerForm] = useState({ name: '', provider_id: '', region: '', size: '', image: '', install_agent: true });

    const loadData = useCallback(async () => {
        try {
            const [pData, sData, cData] = await Promise.all([
                api.getCloudProviders(),
                api.getCloudServers(),
                api.getCloudCosts(),
            ]);
            setProviders(pData.providers || []);
            setServers(sData.servers || []);
            setCosts(cData);
        } catch (err) {
            toast.error('Failed to load cloud data');
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { loadData(); }, [loadData]);

    const handleCreateProvider = async () => {
        try {
            await api.createCloudProvider(providerForm);
            toast.success('Provider added');
            setShowCreateProvider(false);
            loadData();
        } catch (err) { toast.error(err.message); }
    };

    const loadProviderOptions = async (type) => {
        try {
            const data = await api.getCloudProviderOptions(type);
            setProviderOptions(data);
        } catch (err) { toast.error(err.message); }
    };

    const handleCreateServer = async () => {
        try {
            await api.createCloudServer(serverForm);
            toast.success('Server provisioning initiated');
            setShowCreateServer(false);
            loadData();
        } catch (err) { toast.error(err.message); }
    };

    const handleDestroy = async (id) => {
        try {
            await api.destroyCloudServer(id);
            toast.success('Server destroyed');
            setDeleteConfirm(null);
            loadData();
        } catch (err) { toast.error(err.message); }
    };

    const providerTypes = {
        digitalocean: 'DigitalOcean', hetzner: 'Hetzner Cloud', vultr: 'Vultr', linode: 'Linode'
    };

    const serverStatusVariant = (status) => {
        if (status === 'active') return 'success';
        if (status === 'error') return 'destructive';
        return 'warning';
    };

    if (loading) return <Spinner />;

    return (
        <div className="page-container cloud-provision-page">
            <div className="page-header">
                <div className="page-header-content">
                    <h1>Cloud Provisioning</h1>
                    <p className="page-description">
                        {servers.length} server{servers.length !== 1 ? 's' : ''}
                        {costs && ` • $${costs.total_monthly}/mo`}
                    </p>
                </div>
                <div className="page-header-actions">
                    {user?.is_admin && (
                        <>
                            <Button variant="outline" onClick={() => setShowCreateProvider(true)}>Add Provider</Button>
                            <Button onClick={() => setShowCreateServer(true)}>New Server</Button>
                        </>
                    )}
                </div>
            </div>

            <Tabs defaultValue="servers">
                <TabsList>
                    <TabsTrigger value="servers">Servers</TabsTrigger>
                    <TabsTrigger value="providers">Providers</TabsTrigger>
                    <TabsTrigger value="costs">Costs</TabsTrigger>
                </TabsList>

                <TabsContent value="servers">
                    <div className="cloud-servers-grid">
                        {servers.map(srv => (
                            <div key={srv.id} className="cloud-server-card card">
                                <div className="cloud-server-card__header">
                                    <h3>{srv.name}</h3>
                                    <Badge variant={serverStatusVariant(srv.status)}>{srv.status}</Badge>
                                </div>
                                <div className="cloud-server-card__meta">
                                    <span>{srv.provider_name}</span>
                                    <span>{srv.region}</span>
                                    <span>{srv.size}</span>
                                </div>
                                {srv.ip_address && <div className="text-mono">{srv.ip_address}</div>}
                                <div className="cloud-server-card__cost">
                                    ${srv.monthly_cost}/mo
                                </div>
                                <div className="cloud-server-card__actions">
                                    {srv.agent_installed && <Badge variant="success">Agent Installed</Badge>}
                                    {user?.is_admin && srv.status === 'active' && (
                                        <Button size="sm" variant="destructive" onClick={() => setDeleteConfirm(srv)}>Destroy</Button>
                                    )}
                                </div>
                            </div>
                        ))}
                        {servers.length === 0 && <div className="empty-state"><p>No cloud servers provisioned yet.</p></div>}
                    </div>
                </TabsContent>

                <TabsContent value="providers">
                    <div className="providers-list">
                        {providers.map(p => (
                            <div key={p.id} className="provider-row card">
                                <strong>{p.name}</strong>
                                <Badge variant="outline">{providerTypes[p.provider_type] || p.provider_type}</Badge>
                                <span>{p.server_count} servers</span>
                            </div>
                        ))}
                        {providers.length === 0 && <div className="empty-state"><p>No providers configured.</p></div>}
                    </div>
                </TabsContent>

                <TabsContent value="costs">
                    {costs && (
                        <div className="costs-panel card">
                            <h3>Monthly Cost Summary</h3>
                            <div className="cost-total">${costs.total_monthly}/mo across {costs.server_count} servers</div>
                            <div className="cost-breakdown">
                                {Object.entries(costs.by_provider || {}).map(([name, data]) => (
                                    <div key={name} className="cost-row">
                                        <span>{name}</span>
                                        <span>{data.count} servers</span>
                                        <span>${data.cost.toFixed(2)}/mo</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            {showCreateProvider && (
                <div className="modal-overlay" onClick={() => setShowCreateProvider(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h2>Add Cloud Provider</h2><button className="modal-close" onClick={() => setShowCreateProvider(false)}>&times;</button></div>
                        <div className="modal-body">
                            <div className="form-group"><label>Provider</label><select className="form-select" value={providerForm.provider_type} onChange={e => setProviderForm({...providerForm, provider_type: e.target.value})}>{Object.entries(providerTypes).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                            <div className="form-group"><label>Name</label><Input value={providerForm.name} onChange={e => setProviderForm({...providerForm, name: e.target.value})} /></div>
                            <div className="form-group"><label>API Key</label><Input type="password" value={providerForm.api_key} onChange={e => setProviderForm({...providerForm, api_key: e.target.value})} /></div>
                        </div>
                        <div className="modal-footer">
                            <Button variant="outline" onClick={() => setShowCreateProvider(false)}>Cancel</Button>
                            <Button onClick={handleCreateProvider}>Add</Button>
                        </div>
                    </div>
                </div>
            )}

            {showCreateServer && (
                <div className="modal-overlay" onClick={() => setShowCreateServer(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h2>New Cloud Server</h2><button className="modal-close" onClick={() => setShowCreateServer(false)}>&times;</button></div>
                        <div className="modal-body">
                            <div className="form-group"><label>Provider</label><select className="form-select" value={serverForm.provider_id} onChange={e => { setServerForm({...serverForm, provider_id: parseInt(e.target.value)}); const p = providers.find(x => x.id === parseInt(e.target.value)); if (p) loadProviderOptions(p.provider_type); }}><option value="">Select provider</option>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                            <div className="form-group"><label>Server Name</label><Input value={serverForm.name} onChange={e => setServerForm({...serverForm, name: e.target.value})} /></div>
                            {providerOptions && (
                                <>
                                    <div className="form-group"><label>Region</label><select className="form-select" value={serverForm.region} onChange={e => setServerForm({...serverForm, region: e.target.value})}><option value="">Select region</option>{(providerOptions.regions || []).map(r => <option key={r} value={r}>{r}</option>)}</select></div>
                                    <div className="form-group"><label>Size</label><select className="form-select" value={serverForm.size} onChange={e => setServerForm({...serverForm, size: e.target.value})}><option value="">Select size</option>{(providerOptions.sizes || []).map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                                    <div className="form-group"><label>Image</label><select className="form-select" value={serverForm.image} onChange={e => setServerForm({...serverForm, image: e.target.value})}><option value="">Select image</option>{(providerOptions.images || []).map(i => <option key={i} value={i}>{i}</option>)}</select></div>
                                </>
                            )}
                            <div className="form-group"><label className="checkbox-label"><input type="checkbox" checked={serverForm.install_agent} onChange={e => setServerForm({...serverForm, install_agent: e.target.checked})} /> Auto-install ServerKit agent</label></div>
                        </div>
                        <div className="modal-footer">
                            <Button variant="outline" onClick={() => setShowCreateServer(false)}>Cancel</Button>
                            <Button onClick={handleCreateServer} disabled={!serverForm.name || !serverForm.provider_id}>Create</Button>
                        </div>
                    </div>
                </div>
            )}

            {deleteConfirm && (
                <ConfirmDialog title="Destroy Server" message={`Destroy "${deleteConfirm.name}"? This action is irreversible.`} onConfirm={() => handleDestroy(deleteConfirm.id)} onCancel={() => setDeleteConfirm(null)} variant="danger" />
            )}
        </div>
    );
};

export default CloudProvision;
