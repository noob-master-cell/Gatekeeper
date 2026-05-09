import { useCallback, useEffect, useState } from 'react';
import { fetchApiKeys, createApiKey, revokeApiKey, type ApiKey, type CreatedApiKey } from './api';
import { PageHeader, PageLayout } from './components/ui/PageLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/Card';
import { Button } from './components/ui/Button';
import { Skeleton } from './components/ui/Skeleton';
import { formatDistanceToNow } from 'date-fns';
import {
    Key, Plus, Trash2, Copy, Check, AlertTriangle, RefreshCw,
    Clock, Zap, X, ShieldCheck, Eye, EyeOff,
} from 'lucide-react';

const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400';

const ROLE_OPTIONS = ['user', 'hr', 'admin', 'service'];

function RoleBadge({ role }: { role: string }) {
    const map: Record<string, string> = {
        admin:   'bg-red-50 text-red-600 border-red-200',
        hr:      'bg-amber-50 text-amber-700 border-amber-200',
        service: 'bg-blue-50 text-blue-700 border-blue-200',
        user:    'bg-slate-50 text-slate-600 border-slate-200',
    };
    return (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${map[role] ?? map.user}`}>
            {role}
        </span>
    );
}

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <button onClick={copy} className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
        </button>
    );
}

function NewKeyBanner({ created, onDismiss }: { created: CreatedApiKey; onDismiss: () => void }) {
    const [visible, setVisible] = useState(false);

    return (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 space-y-3">
            <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 text-emerald-800">
                    <ShieldCheck className="h-4 w-4 shrink-0" />
                    <span className="text-sm font-semibold">API key created — copy it now</span>
                </div>
                <button onClick={onDismiss} className="text-emerald-600 hover:text-emerald-800 transition-colors">
                    <X className="h-4 w-4" />
                </button>
            </div>
            <p className="text-xs text-emerald-700">
                This key will <strong>never be shown again</strong>. Copy it to a secure location before dismissing.
            </p>
            <div className="flex items-center gap-3 bg-white rounded-lg border border-emerald-200 px-4 py-3">
                <code className="flex-1 font-mono text-sm text-slate-800 tracking-wide break-all select-all">
                    {visible ? created.key : created.key.replace(/./g, '•').slice(0, 40) + '...'}
                </code>
                <button
                    onClick={() => setVisible(v => !v)}
                    className="text-slate-400 hover:text-slate-700 transition-colors shrink-0"
                    title={visible ? 'Hide key' : 'Show key'}
                >
                    {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <CopyButton text={created.key} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-emerald-700">
                <span><strong>Name:</strong> {created.name}</span>
                <span><strong>Owner:</strong> {created.owner}</span>
                <span><strong>Roles:</strong> {created.roles.join(', ')}</span>
                <span><strong>Rate limit:</strong> {created.rate_limit} req/min</span>
            </div>
        </div>
    );
}

export default function ApiKeysView() {
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
    const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
    const [revoking, setRevoking] = useState<string | null>(null);

    // form state
    const [isAdding, setIsAdding] = useState(false);
    const [name, setName] = useState('');
    const [owner, setOwner] = useState('');
    const [selectedRoles, setSelectedRoles] = useState<string[]>(['user']);
    const [rateLimit, setRateLimit] = useState('1000');
    const [creating, setCreating] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setLoading(true); setError(null);
            setKeys(await fetchApiKeys());
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load API keys');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const toggleRole = (role: string) => {
        setSelectedRoles(prev =>
            prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
        );
    };

    const resetForm = () => {
        setName(''); setOwner(''); setSelectedRoles(['user']); setRateLimit('1000');
        setFormError(null); setIsAdding(false);
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !owner.trim()) { setFormError('Name and owner are required'); return; }
        if (selectedRoles.length === 0) { setFormError('Select at least one role'); return; }
        const rl = parseInt(rateLimit, 10);
        if (!rl || rl < 1) { setFormError('Rate limit must be a positive number'); return; }
        try {
            setCreating(true); setFormError(null);
            const result = await createApiKey({ name: name.trim(), owner: owner.trim(), roles: selectedRoles, rate_limit: rl });
            setCreatedKey(result);
            resetForm();
            await load();
        } catch (e) {
            setFormError(e instanceof Error ? e.message : 'Failed to create key');
        } finally {
            setCreating(false);
        }
    };

    const handleRevoke = async (keyHash: string) => {
        if (confirmRevoke !== keyHash) { setConfirmRevoke(keyHash); return; }
        setConfirmRevoke(null);
        setRevoking(keyHash);
        try {
            await revokeApiKey(keyHash);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to revoke key');
        } finally {
            setRevoking(null);
        }
    };

    if (loading && keys.length === 0) {
        return (
            <PageLayout>
                <PageHeader title="API Keys" description="Service-to-service authentication" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-64 w-full" />
            </PageLayout>
        );
    }

    return (
        <PageLayout>
            <PageHeader
                title="API Keys"
                description={`${keys.length} key${keys.length !== 1 ? 's' : ''} · service-to-service and CLI authentication`}
                action={
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={load} isLoading={loading}>
                            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
                        </Button>
                        <Button size="sm" variant={isAdding ? 'secondary' : 'default'} onClick={() => { setIsAdding(!isAdding); setFormError(null); }}>
                            {isAdding ? <><X className="mr-1.5 h-4 w-4" /> Cancel</> : <><Plus className="mr-1.5 h-4 w-4" /> New Key</>}
                        </Button>
                    </div>
                }
            />

            {/* Created key banner */}
            {createdKey && <NewKeyBanner created={createdKey} onDismiss={() => setCreatedKey(null)} />}

            {/* Error */}
            {error && (
                <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
                </div>
            )}

            {/* Create form */}
            {isAdding && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm">Create API Key</CardTitle>
                        <CardDescription>Keys are hashed with SHA-256 and stored in Redis. The raw key is only shown once.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleCreate} className="space-y-5 max-w-xl">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Key Name *</label>
                                    <input
                                        value={name} onChange={e => setName(e.target.value)}
                                        className={inputCls} placeholder="e.g. CI Pipeline"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Owner *</label>
                                    <input
                                        value={owner} onChange={e => setOwner(e.target.value)}
                                        className={inputCls} placeholder="e.g. ci@company.com"
                                        required
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-2">Roles *</label>
                                <div className="flex flex-wrap gap-2">
                                    {ROLE_OPTIONS.map(role => (
                                        <button
                                            key={role} type="button"
                                            onClick={() => toggleRole(role)}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                                                selectedRoles.includes(role)
                                                    ? 'bg-brand-500 text-white border-brand-600 shadow-sm'
                                                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                                            }`}
                                        >
                                            {selectedRoles.includes(role) && <Check className="h-3 w-3" />}
                                            {role}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                                    Rate Limit (requests / min)
                                </label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="range" min="10" max="10000" step="10"
                                        value={rateLimit}
                                        onChange={e => setRateLimit(e.target.value)}
                                        className="flex-1 h-1.5 accent-brand-500"
                                    />
                                    <input
                                        type="number" min="1" max="100000"
                                        value={rateLimit} onChange={e => setRateLimit(e.target.value)}
                                        className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 tabular-nums"
                                    />
                                </div>
                            </div>

                            {formError && (
                                <p className="text-xs text-red-600 flex items-center gap-1.5">
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {formError}
                                </p>
                            )}

                            <div className="flex items-center gap-3 pt-1">
                                <Button type="submit" size="sm" isLoading={creating}>
                                    <Key className="mr-1.5 h-4 w-4" /> Generate Key
                                </Button>
                                <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                                    Cancel
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            )}

            {/* Keys table */}
            {keys.length === 0 && !loading ? (
                <Card className="flex flex-col items-center justify-center py-16 border-dashed">
                    <Key className="h-10 w-10 text-slate-300 mb-3" />
                    <p className="font-medium text-slate-600">No API keys</p>
                    <p className="text-sm text-slate-400 mt-1">Create a key for service-to-service or CLI access.</p>
                </Card>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2">
                            <Key className="h-4 w-4 text-slate-500" /> Active Keys
                        </CardTitle>
                        <CardDescription>Keys authenticate via <code className="text-[11px] bg-slate-100 px-1.5 py-0.5 rounded">X-API-Key</code> header</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left whitespace-nowrap">
                                <thead className="bg-slate-50 border-y border-slate-200">
                                    <tr>
                                        {['Key', 'Name', 'Owner', 'Roles', 'Rate Limit', 'Created', 'Last Used', ''].map(h => (
                                            <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {keys.map(k => {
                                        const isRevoking = revoking === k.key_hash;
                                        const needsConfirm = confirmRevoke === k.key_hash;
                                        return (
                                            <tr key={k.key_hash} className="group hover:bg-slate-50/80 transition-colors">
                                                {/* Key prefix */}
                                                <td className="px-4 py-3">
                                                    <code className="text-xs font-mono text-brand-600 bg-brand-50 border border-brand-100 px-2 py-1 rounded-md">
                                                        {k.key_prefix}
                                                    </code>
                                                </td>

                                                {/* Name */}
                                                <td className="px-4 py-3 text-sm font-medium text-slate-800">{k.name}</td>

                                                {/* Owner */}
                                                <td className="px-4 py-3 text-xs text-slate-500 max-w-[160px] truncate" title={k.owner}>{k.owner}</td>

                                                {/* Roles */}
                                                <td className="px-4 py-3">
                                                    <div className="flex gap-1 flex-wrap">
                                                        {k.roles.map(r => <RoleBadge key={r} role={r} />)}
                                                    </div>
                                                </td>

                                                {/* Rate limit */}
                                                <td className="px-4 py-3">
                                                    <span className="flex items-center gap-1 text-xs text-slate-600">
                                                        <Zap className="h-3 w-3 text-amber-400" />
                                                        {k.rate_limit.toLocaleString()}/min
                                                    </span>
                                                </td>

                                                {/* Created */}
                                                <td className="px-4 py-3 text-xs text-slate-400">
                                                    <span className="flex items-center gap-1">
                                                        <Clock className="h-3 w-3" />
                                                        {formatDistanceToNow(new Date(k.created_at), { addSuffix: true })}
                                                    </span>
                                                </td>

                                                {/* Last used */}
                                                <td className="px-4 py-3 text-xs text-slate-400">
                                                    {k.last_used
                                                        ? formatDistanceToNow(new Date(k.last_used), { addSuffix: true })
                                                        : <span className="italic">Never</span>
                                                    }
                                                </td>

                                                {/* Actions */}
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        {needsConfirm && (
                                                            <>
                                                                <span className="text-xs text-red-500 font-medium">Confirm?</span>
                                                                <Button
                                                                    variant="destructive" size="sm"
                                                                    isLoading={isRevoking}
                                                                    onClick={() => handleRevoke(k.key_hash)}
                                                                    className="h-7 text-xs px-2"
                                                                >
                                                                    Revoke
                                                                </Button>
                                                                <Button
                                                                    variant="ghost" size="sm"
                                                                    onClick={() => setConfirmRevoke(null)}
                                                                    className="h-7 text-xs px-2"
                                                                >
                                                                    Cancel
                                                                </Button>
                                                            </>
                                                        )}
                                                        {!needsConfirm && (
                                                            <Button
                                                                variant="ghost" size="icon"
                                                                isLoading={isRevoking}
                                                                onClick={() => handleRevoke(k.key_hash)}
                                                                className="h-7 w-7 text-slate-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                                            >
                                                                {!isRevoking && <Trash2 className="h-3.5 w-3.5" />}
                                                            </Button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            )}
        </PageLayout>
    );
}
