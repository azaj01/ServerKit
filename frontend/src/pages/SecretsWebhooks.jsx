import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../services/api';
import { PageTopbar } from '@/components/ds';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '../contexts/ToastContext';
import { KeyRound, Webhook, Plus, MoreVertical, Copy, Eye, EyeOff, Trash2, RefreshCw, ArrowRightLeft } from 'lucide-react';
import EmptyState from '../components/EmptyState';

const VALID_TABS = ['vaults', 'webhooks'];

const formatDate = (d) => (d ? new Date(d).toLocaleString() : '—');

export default function SecretsWebhooks() {
    const { tab } = useParams();
    const navigate = useNavigate();
    const { toast } = useToast();
    const activeTab = VALID_TABS.includes(tab) ? tab : 'vaults';

    const [vaults, setVaults] = useState([]);
    const [endpoints, setEndpoints] = useState([]);
    const [loading, setLoading] = useState(true);

    // Vault modals
    const [vaultForm, setVaultForm] = useState({ open: false, name: '', description: '' });
    const [selectedVault, setSelectedVault] = useState(null);
    const [secretForm, setSecretForm] = useState({ open: false, name: '', value: '', description: '' });
    const [revealSecretId, setRevealSecretId] = useState(null);
    const [revealedValue, setRevealedValue] = useState('');

    // Webhook modals
    const [endpointForm, setEndpointForm] = useState({ open: false, name: '', forward_url: '', filter_paths: '', retry_count: 3 });
    const [selectedEndpoint, setSelectedEndpoint] = useState(null);
    const [deliveries, setDeliveries] = useState([]);
    const [regeneratedSecret, setRegeneratedSecret] = useState(null);

    useEffect(() => {
        loadAll();
    }, []);

    async function loadAll() {
        setLoading(true);
        try {
            const [v, e] = await Promise.all([api.listVaults(), api.listWebhookEndpoints()]);
            setVaults(v.vaults || []);
            setEndpoints(e.endpoints || []);
        } catch (err) {
            toast.error(`Load failed: ${err.message}`);
        } finally {
            setLoading(false);
        }
    }

    async function createVault(e) {
        e.preventDefault();
        try {
            await api.createVault({ name: vaultForm.name, description: vaultForm.description });
            setVaultForm({ open: false, name: '', description: '' });
            loadAll();
            toast.success('Vault created');
        } catch (err) {
            toast.error(`Failed to create vault: ${err.message}`);
        }
    }

    async function deleteVault(id) {
        if (!confirm('Delete this vault and all its secrets?')) return;
        try {
            await api.deleteVault(id);
            if (selectedVault?.id === id) setSelectedVault(null);
            loadAll();
            toast.success('Vault deleted');
        } catch (err) {
            toast.error(`Failed to delete vault: ${err.message}`);
        }
    }

    async function createSecret(e) {
        e.preventDefault();
        try {
            await api.createSecret(selectedVault.id, {
                name: secretForm.name,
                value: secretForm.value,
                description: secretForm.description,
            });
            setSecretForm({ open: false, name: '', value: '', description: '' });
            openVault(selectedVault.id);
            toast.success('Secret created')
        } catch (err) {
            toast.error(`Failed to create secret: ${err.message}`)
        }
    }

    async function openVault(id) {
        try {
            const { vault } = await api.getVault(id);
            const { secrets } = await api.listSecrets(id);
            setSelectedVault({ ...vault, secrets });
        } catch (err) {
            toast.error(`Failed to load vault: ${err.message}`)
        }
    }

    async function revealSecret(secret) {
        try {
            const { secret: data } = await api.revealSecret(secret.id);
            setRevealSecretId(secret.id);
            setRevealedValue(data.value || '');
        } catch (err) {
            toast.error(`Reveal failed: ${err.message}`)
        }
    }

    async function deleteSecret(id) {
        if (!confirm('Delete this secret?')) return;
        try {
            await api.deleteSecret(id);
            openVault(selectedVault.id);
            toast.success('Secret deleted')
        } catch (err) {
            toast.error(`Failed to delete secret: ${err.message}`)
        }
    }

    async function createEndpoint(e) {
        e.preventDefault();
        try {
            const paths = endpointForm.filter_paths.split('\n').map(s => s.trim()).filter(Boolean);
            await api.createWebhookEndpoint({
                name: endpointForm.name,
                forward_url: endpointForm.forward_url,
                filter_paths: paths,
                retry_count: parseInt(endpointForm.retry_count, 10) || 3,
            });
            setEndpointForm({ open: false, name: '', forward_url: '', filter_paths: '', retry_count: 3 });
            loadAll();
            toast.success('Endpoint created')
        } catch (err) {
            toast.error(`Failed to create endpoint: ${err.message}`)
        }
    }

    async function deleteEndpoint(id) {
        if (!confirm('Delete this webhook endpoint?')) return;
        try {
            await api.deleteWebhookEndpoint(id);
            if (selectedEndpoint?.id === id) setSelectedEndpoint(null);
            loadAll();
            toast.success('Endpoint deleted')
        } catch (err) {
            toast.error(`Failed to delete endpoint: ${err.message}`)
        }
    }

    async function regenerateSecret(id) {
        try {
            const data = await api.regenerateWebhookSecret(id);
            setRegeneratedSecret({ name: data.endpoint.name, secret: data.secret });
            loadAll();
            if (selectedEndpoint?.id === id) openEndpoint(data.endpoint.id);
        } catch (err) {
            toast.error(`Regenerate failed: ${err.message}`)
        }
    }

    async function openEndpoint(id) {
        try {
            const { endpoint } = await api.getWebhookEndpoint(id);
            const { deliveries } = await api.listWebhookDeliveries(id, { limit: 50 });
            setSelectedEndpoint(endpoint);
            setDeliveries(deliveries || []);
        } catch (err) {
            toast.error(`Failed to load endpoint: ${err.message}`)
        }
    }

    async function replayDelivery(deliveryId) {
        try {
            await api.replayWebhookDelivery(deliveryId);
            openEndpoint(selectedEndpoint.id);
            toast.success('Replayed delivery')
        } catch (err) {
            toast.error(`Replay failed: ${err.message}`)
        }
    }

    const receiverUrl = useMemo(() => {
        if (!selectedEndpoint) return '';
        const base = window.location.origin.replace(/\/$/, '');
        return `${base}/api/v1/webhooks/receive/${selectedEndpoint.slug}`;
    }, [selectedEndpoint]);

    if (loading) {
        return (
            <div className="page-container secrets-page">
                <EmptyState loading title="Loading secrets & webhooks..." />
            </div>
        );
    }

    return (
        <div className="page-container secrets-page">
            <PageTopbar icon={<KeyRound size={18} />} title="Secrets & Webhooks" />

            <Tabs value={activeTab} onValueChange={(v) => navigate(`/secrets/${v}`)} className="tabs">
                <TabsList>
                    <TabsTrigger value="vaults"><KeyRound size={14} /> Vaults</TabsTrigger>
                    <TabsTrigger value="webhooks"><Webhook size={14} /> Webhooks</TabsTrigger>
                </TabsList>

                <TabsContent value="vaults" className="tab-content">
                    {!selectedVault ? (
                        <Card>
                            <CardHeader>
                                <div className="secrets__header">
                                    <div>
                                        <CardTitle>Secret Vaults</CardTitle>
                                        <CardDescription>Encrypted key/value stores for credentials and tokens.</CardDescription>
                                    </div>
                                    <Button onClick={() => setVaultForm({ open: true, name: '', description: '' })}>
                                        <Plus size={14} /> New Vault
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                {vaults.length === 0 ? (
                                    <EmptyState title="No vaults yet" description="Create a vault to start storing secrets." />
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Name</TableHead>
                                                <TableHead>Description</TableHead>
                                                <TableHead>Secrets</TableHead>
                                                <TableHead className="text-right">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {vaults.map(vault => (
                                                <TableRow key={vault.id} className="cursor-pointer" onClick={() => openVault(vault.id)}>
                                                    <TableCell className="font-medium">{vault.name}</TableCell>
                                                    <TableCell>{vault.description || '—'}</TableCell>
                                                    <TableCell>{vault.secret_count ?? '—'}</TableCell>
                                                    <TableCell className="text-right">
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                                                <Button variant="ghost" size="icon"><MoreVertical size={14} /></Button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end">
                                                                <DropdownMenuItem onClick={() => openVault(vault.id)}>Open</DropdownMenuItem>
                                                                <DropdownMenuItem className="text-destructive" onClick={() => deleteVault(vault.id)}>Delete</DropdownMenuItem>
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </CardContent>
                        </Card>
                    ) : (
                        <Card>
                            <CardHeader>
                                <div className="secrets__header">
                                    <div>
                                        <Button variant="ghost" size="sm" onClick={() => setSelectedVault(null)}>← Back</Button>
                                        <CardTitle className="mt-2">{selectedVault.name}</CardTitle>
                                        <CardDescription>{selectedVault.description || 'No description'}</CardDescription>
                                    </div>
                                    <Button onClick={() => setSecretForm({ open: true, name: '', value: '', description: '' })}>
                                        <Plus size={14} /> Add Secret
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                {(selectedVault.secrets || []).length === 0 ? (
                                    <EmptyState title="No secrets yet" description="Add your first secret to this vault." />
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Name</TableHead>
                                                <TableHead>Value</TableHead>
                                                <TableHead>Description</TableHead>
                                                <TableHead>Updated</TableHead>
                                                <TableHead className="text-right">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {selectedVault.secrets.map(secret => {
                                                const revealed = revealSecretId === secret.id;
                                                return (
                                                    <TableRow key={secret.id}>
                                                        <TableCell className="font-medium">{secret.name}</TableCell>
                                                        <TableCell>
                                                            <code className="secrets__value">
                                                                {revealed ? revealedValue : secret.value}
                                                            </code>
                                                        </TableCell>
                                                        <TableCell>{secret.description || '—'}</TableCell>
                                                        <TableCell>{formatDate(secret.updated_at)}</TableCell>
                                                        <TableCell className="text-right">
                                                            <Button variant="ghost" size="icon" onClick={() => revealed ? setRevealSecretId(null) : revealSecret(secret)}>
                                                                {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                                                            </Button>
                                                            <Button variant="ghost" size="icon" onClick={() => { navigator.clipboard.writeText(revealed ? revealedValue : secret.value); toast.success('Copied') }}>
                                                                <Copy size={14} />
                                                            </Button>
                                                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteSecret(secret.id)}>
                                                                <Trash2 size={14} />
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                <TabsContent value="webhooks" className="tab-content">
                    {!selectedEndpoint ? (
                        <Card>
                            <CardHeader>
                                <div className="secrets__header">
                                    <div>
                                        <CardTitle>Webhook Endpoints</CardTitle>
                                        <CardDescription>Receive, verify, and forward inbound webhooks.</CardDescription>
                                    </div>
                                    <Button onClick={() => setEndpointForm({ open: true, name: '', forward_url: '', filter_paths: '', retry_count: 3 })}>
                                        <Plus size={14} /> New Endpoint
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                {endpoints.length === 0 ? (
                                    <EmptyState title="No webhook endpoints" description="Create an endpoint to receive webhooks." />
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Name</TableHead>
                                                <TableHead>Slug</TableHead>
                                                <TableHead>Forward URL</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead className="text-right">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {endpoints.map(ep => (
                                                <TableRow key={ep.id} className="cursor-pointer" onClick={() => openEndpoint(ep.id)}>
                                                    <TableCell className="font-medium">{ep.name}</TableCell>
                                                    <TableCell>{ep.slug}</TableCell>
                                                    <TableCell>{ep.forward_url || '—'}</TableCell>
                                                    <TableCell><Badge variant={ep.is_active ? 'default' : 'secondary'}>{ep.is_active ? 'Active' : 'Inactive'}</Badge></TableCell>
                                                    <TableCell className="text-right">
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                                                <Button variant="ghost" size="icon"><MoreVertical size={14} /></Button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end">
                                                                <DropdownMenuItem onClick={() => openEndpoint(ep.id)}>View deliveries</DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => regenerateSecret(ep.id)}><RefreshCw size={12} className="mr-2" /> Regenerate secret</DropdownMenuItem>
                                                                <DropdownMenuItem className="text-destructive" onClick={() => deleteEndpoint(ep.id)}>Delete</DropdownMenuItem>
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </CardContent>
                        </Card>
                    ) : (
                        <Card>
                            <CardHeader>
                                <div className="secrets__header">
                                    <div>
                                        <Button variant="ghost" size="sm" onClick={() => setSelectedEndpoint(null)}>← Back</Button>
                                        <CardTitle className="mt-2">{selectedEndpoint.name}</CardTitle>
                                        <CardDescription>
                                            POST to <code className="secrets__code">{receiverUrl}</code>
                                        </CardDescription>
                                    </div>
                                    <Button variant="outline" onClick={() => regenerateSecret(selectedEndpoint.id)}>
                                        <RefreshCw size={14} /> Regenerate secret
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                {deliveries.length === 0 ? (
                                    <EmptyState title="No deliveries yet" description="Send a test payload to see it here." />
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Event ID</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Signature</TableHead>
                                                <TableHead>Received</TableHead>
                                                <TableHead className="text-right">Actions</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {deliveries.map(d => (
                                                <TableRow key={d.id}>
                                                    <TableCell className="font-mono text-xs max-w-[200px] truncate">{d.event_id}</TableCell>
                                                    <TableCell><WebhookStatusBadge status={d.status} /></TableCell>
                                                    <TableCell>{d.signature_valid === true ? 'Valid' : d.signature_valid === false ? 'Invalid' : '—'}</TableCell>
                                                    <TableCell>{formatDate(d.received_at)}</TableCell>
                                                    <TableCell className="text-right">
                                                        <Button variant="ghost" size="icon" onClick={() => replayDelivery(d.id)} title="Replay">
                                                            <ArrowRightLeft size={14} />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>
            </Tabs>

            <Dialog open={vaultForm.open} onOpenChange={(open) => setVaultForm({ ...vaultForm, open })}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>New Vault</DialogTitle>
                        <DialogDescription>Create an encrypted vault to group secrets.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={createVault} className="space-y-4">
                        <div>
                            <Label htmlFor="vaultName">Name</Label>
                            <Input id="vaultName" value={vaultForm.name} onChange={(e) => setVaultForm({ ...vaultForm, name: e.target.value })} required />
                        </div>
                        <div>
                            <Label htmlFor="vaultDesc">Description</Label>
                            <Textarea id="vaultDesc" value={vaultForm.description} onChange={(e) => setVaultForm({ ...vaultForm, description: e.target.value })} />
                        </div>
                        <DialogFooter>
                            <Button type="submit">Create Vault</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={secretForm.open} onOpenChange={(open) => setSecretForm({ ...secretForm, open })}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add Secret</DialogTitle>
                        <DialogDescription>Add an encrypted secret to {selectedVault?.name}.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={createSecret} className="space-y-4">
                        <div>
                            <Label htmlFor="secretName">Name</Label>
                            <Input id="secretName" value={secretForm.name} onChange={(e) => setSecretForm({ ...secretForm, name: e.target.value })} required />
                        </div>
                        <div>
                            <Label htmlFor="secretValue">Value</Label>
                            <Textarea id="secretValue" value={secretForm.value} onChange={(e) => setSecretForm({ ...secretForm, value: e.target.value })} required />
                        </div>
                        <div>
                            <Label htmlFor="secretDesc">Description</Label>
                            <Textarea id="secretDesc" value={secretForm.description} onChange={(e) => setSecretForm({ ...secretForm, description: e.target.value })} />
                        </div>
                        <DialogFooter>
                            <Button type="submit">Save Secret</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={endpointForm.open} onOpenChange={(open) => setEndpointForm({ ...endpointForm, open })}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>New Webhook Endpoint</DialogTitle>
                        <DialogDescription>Create a slug, secret, and optional forward URL.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={createEndpoint} className="space-y-4">
                        <div>
                            <Label htmlFor="epName">Name</Label>
                            <Input id="epName" value={endpointForm.name} onChange={(e) => setEndpointForm({ ...endpointForm, name: e.target.value })} required />
                        </div>
                        <div>
                            <Label htmlFor="epForward">Forward URL (optional)</Label>
                            <Input id="epForward" type="url" value={endpointForm.forward_url} onChange={(e) => setEndpointForm({ ...endpointForm, forward_url: e.target.value })} />
                        </div>
                        <div>
                            <Label htmlFor="epFilters">Filter paths (one per line, optional)</Label>
                            <Textarea id="epFilters" value={endpointForm.filter_paths} onChange={(e) => setEndpointForm({ ...endpointForm, filter_paths: e.target.value })} placeholder="repository.full_name&#10;action" />
                        </div>
                        <div>
                            <Label htmlFor="epRetry">Retries</Label>
                            <Input id="epRetry" type="number" min={0} max={10} value={endpointForm.retry_count} onChange={(e) => setEndpointForm({ ...endpointForm, retry_count: e.target.value })} />
                        </div>
                        <DialogFooter>
                            <Button type="submit">Create Endpoint</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={!!regeneratedSecret} onOpenChange={() => setRegeneratedSecret(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Webhook Secret</DialogTitle>
                        <DialogDescription>Copy this secret now. It will not be shown again.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label>Endpoint</Label>
                        <Input readOnly value={regeneratedSecret?.name || ''} />
                        <Label>Secret</Label>
                        <div className="flex gap-2">
                            <Input readOnly type="text" value={regeneratedSecret?.secret || ''} />
                            <Button variant="outline" onClick={() => { navigator.clipboard.writeText(regeneratedSecret?.secret || ''); toast.success('Copied') }}>
                                <Copy size={14} />
                            </Button>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button onClick={() => setRegeneratedSecret(null)}>Done</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function WebhookStatusBadge({ status }) {
    const variant = status === 'forwarded' ? 'default' : status === 'received' ? 'secondary' : status === 'filtered' ? 'outline' : 'destructive';
    return <Badge variant={variant}>{status}</Badge>;
}
