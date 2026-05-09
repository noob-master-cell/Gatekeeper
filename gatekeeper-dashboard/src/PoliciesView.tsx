import React, { useEffect, useState } from 'react';
import { ShieldAlert, Plus, Trash2, Shield, Globe, Code2, RefreshCw, CheckCircle, XCircle, X, Terminal } from 'lucide-react';
import { fetchPolicies, createPolicy, deletePolicy, simulatePolicy, fetchOpaPolicy, pushOpaPolicy, type Policy, type PolicySimulationResponse } from './api';
import { PageHeader, PageLayout } from './components/ui/PageLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/Card';
import { Badge } from './components/ui/Badge';
import { Button } from './components/ui/Button';
import { Skeleton } from './components/ui/Skeleton';

const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400';
const selectCls = inputCls;

export default function PoliciesView() {
    const [policies, setPolicies] = useState<Policy[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isAdding, setIsAdding] = useState(false);
    const [newPolicyName, setNewPolicyName] = useState('');
    const [newPolicyPattern, setNewPolicyPattern] = useState('');
    const [newPolicyPriority, setNewPolicyPriority] = useState('100');
    const [newPolicyRoles, setNewPolicyRoles] = useState('admin,hr');
    const [newPolicyAnyAuth, setNewPolicyAnyAuth] = useState(false);

    const [simEmail, setSimEmail] = useState('test@user.com');
    const [simRoles, setSimRoles] = useState('hr');
    const [simPath, setSimPath] = useState('/api/hr/salary');
    const [simMethod, setSimMethod] = useState('GET');
    const [simResult, setSimResult] = useState<PolicySimulationResponse | null>(null);
    const [simulating, setSimulating] = useState(false);

    const [opaPolicy, setOpaPolicy] = useState('');
    const [opaSaving, setOpaSaving] = useState(false);
    const [opaStatus, setOpaStatus] = useState<{ ok: boolean; message: string } | null>(null);
    const [opaLoading, setOpaLoading] = useState(false);

    const loadOpaPolicy = async () => {
        setOpaLoading(true);
        const p = await fetchOpaPolicy();
        if (p !== null) setOpaPolicy(p);
        setOpaLoading(false);
    };

    const handleOpaDeploy = async (e: React.FormEvent) => {
        e.preventDefault();
        setOpaSaving(true); setOpaStatus(null);
        try {
            const result = await pushOpaPolicy(opaPolicy);
            setOpaStatus({ ok: result.pushed, message: result.reason || (result.pushed ? 'Deployed successfully' : 'Deploy failed') });
        } catch (err: any) {
            setOpaStatus({ ok: false, message: err.message || 'Deploy failed' });
        } finally {
            setOpaSaving(false);
        }
    };

    const handleSimulate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setSimulating(true); setSimResult(null);
            setSimResult(await simulatePolicy({ email: simEmail, roles: simRoles.split(',').map(r => r.trim()).filter(Boolean), path: simPath, method: simMethod }));
        } catch (err: any) { alert(err.message || 'Simulation failed'); }
        finally { setSimulating(false); }
    };

    const loadPolicies = async () => {
        try { setLoading(true); setError(null); setPolicies(await fetchPolicies()); }
        catch (err: any) { setError(err.message || 'Failed to fetch policies'); }
        finally { setLoading(false); }
    };

    useEffect(() => { loadPolicies(); }, []);

    const handleDelete = async (name: string) => {
        if (!window.confirm(`Delete policy '${name}'?`)) return;
        try { await deletePolicy(name); await loadPolicies(); }
        catch (err: any) { alert(err.message || 'Delete failed'); }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await createPolicy({ name: newPolicyName, pattern: newPolicyPattern, priority: parseInt(newPolicyPriority, 10), allow_any_authenticated: newPolicyAnyAuth, roles: newPolicyAnyAuth ? [] : newPolicyRoles.split(',').map(r => r.trim()).filter(Boolean), is_active: true });
            setIsAdding(false); setNewPolicyName(''); setNewPolicyPattern(''); setNewPolicyAnyAuth(false);
            await loadPolicies();
        } catch (err: any) { alert(err.message || 'Create failed'); }
    };

    if (loading && policies.length === 0) {
        return (
            <PageLayout>
                <PageHeader title="Policies" description="Route-level RBAC rules" />
                <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
            </PageLayout>
        );
    }

    return (
        <PageLayout>
            <PageHeader
                title="Access Policies"
                description="Manage zero-trust route policies and role requirements"
                action={
                    <Button size="sm" variant={isAdding ? 'secondary' : 'default'} onClick={() => setIsAdding(!isAdding)}>
                        {isAdding ? <><X className="mr-1.5 h-4 w-4" />Cancel</> : <><Plus className="mr-1.5 h-4 w-4" />New Policy</>}
                    </Button>
                }
            />

            {error && <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm mb-2">{error}</div>}

            {/* New Policy Form */}
            {isAdding && (
                <Card className="mb-2">
                    <CardContent className="p-5">
                        <h3 className="text-sm font-semibold text-slate-900 mb-4">Create Route Policy</h3>
                        <form onSubmit={handleCreate} className="space-y-4 max-w-2xl">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Policy Name</label>
                                    <input required value={newPolicyName} onChange={e => setNewPolicyName(e.target.value)} className={inputCls} placeholder="Finance API" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Route Regex</label>
                                    <input required value={newPolicyPattern} onChange={e => setNewPolicyPattern(e.target.value)} className={inputCls + ' font-mono'} placeholder="^/api/finance(/.*)?$" />
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Priority</label>
                                    <input required type="number" value={newPolicyPriority} onChange={e => setNewPolicyPriority(e.target.value)} className={inputCls} />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Required Roles</label>
                                    <input disabled={newPolicyAnyAuth} value={newPolicyRoles} onChange={e => setNewPolicyRoles(e.target.value)} className={inputCls + ' disabled:opacity-50'} placeholder="admin, hr" />
                                </div>
                            </div>
                            <label className="flex items-center gap-2.5 cursor-pointer">
                                <input type="checkbox" checked={newPolicyAnyAuth} onChange={e => setNewPolicyAnyAuth(e.target.checked)} className="rounded border-slate-300 text-brand-500 focus:ring-brand-500 w-4 h-4" />
                                <span className="text-sm text-slate-600">Allow any authenticated user (bypass RBAC)</span>
                            </label>
                            <div className="flex justify-end gap-2 pt-1">
                                <Button type="button" variant="ghost" size="sm" onClick={() => setIsAdding(false)}>Cancel</Button>
                                <Button type="submit" size="sm">Save Policy</Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            )}

            {/* Simulator */}
            <Card className="mb-2">
                <CardHeader className="border-b border-slate-100 pb-4">
                    <CardTitle className="flex items-center gap-2 text-sm">
                        <Terminal className="h-4 w-4 text-slate-500" /> Policy Simulator
                    </CardTitle>
                    <CardDescription>Test if a user would be granted access under current policies</CardDescription>
                </CardHeader>
                <CardContent className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <form onSubmit={handleSimulate} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1.5">Email</label>
                                <input required value={simEmail} onChange={e => setSimEmail(e.target.value)} className={inputCls} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1.5">Roles (comma-sep)</label>
                                <input required value={simRoles} onChange={e => setSimRoles(e.target.value)} className={inputCls} />
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="col-span-2">
                                <label className="block text-xs font-medium text-slate-500 mb-1.5">Path</label>
                                <input required value={simPath} onChange={e => setSimPath(e.target.value)} className={inputCls + ' font-mono'} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1.5">Method</label>
                                <select value={simMethod} onChange={e => setSimMethod(e.target.value)} className={selectCls}>
                                    {['GET','POST','PUT','PATCH','DELETE'].map(m => <option key={m}>{m}</option>)}
                                </select>
                            </div>
                        </div>
                        <Button type="submit" variant="secondary" isLoading={simulating} className="w-full">
                            Run Simulation
                        </Button>
                    </form>

                    {/* Result */}
                    <div className={`rounded-xl border p-4 flex flex-col justify-center min-h-[140px] transition-colors ${simResult ? (simResult.allowed ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200') : 'bg-slate-50 border-slate-200'}`}>
                        {!simResult ? (
                            <p className="text-slate-400 text-sm text-center">Results will appear here after simulation</p>
                        ) : (
                            <div className="space-y-3">
                                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold ${simResult.allowed ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                    {simResult.allowed ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                                    {simResult.allowed ? 'Access Granted' : 'Access Denied'}
                                </div>
                                <div className="space-y-1.5 text-sm font-mono">
                                    <div><span className="text-slate-400">User: </span><span className="text-slate-700">{simResult.email} [{simResult.simulated_roles.join(', ')}]</span></div>
                                    <div><span className="text-slate-400">Path: </span><span className="text-slate-700">{simMethod} {simResult.path}</span></div>
                                    <div><span className="text-slate-400">Rule: </span><span className={simResult.allowed ? 'text-emerald-600' : 'text-red-600'}>{simResult.reason}</span></div>
                                </div>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* OPA Hot-Reload */}
            <Card className="mb-2">
                <CardHeader className="border-b border-slate-100 pb-4">
                    <CardTitle className="flex items-center gap-2 text-sm">
                        <Code2 className="h-4 w-4 text-amber-500" /> OPA Policy Engine
                    </CardTitle>
                    <CardDescription>Edit and deploy Rego policy — changes take effect immediately without a restart</CardDescription>
                </CardHeader>
                <CardContent className="p-5 space-y-4">
                    <Button variant="outline" size="sm" isLoading={opaLoading} onClick={loadOpaPolicy}>
                        <RefreshCw className={`mr-1.5 h-4 w-4 ${opaLoading ? 'animate-spin' : ''}`} /> Load Current Policy
                    </Button>
                    <form onSubmit={handleOpaDeploy} className="space-y-3">
                        <textarea
                            value={opaPolicy}
                            onChange={e => setOpaPolicy(e.target.value)}
                            rows={12}
                            className="w-full rounded-xl border border-slate-200 bg-slate-900 px-4 py-3 text-sm text-emerald-400 font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 resize-y"
                            placeholder={`package gatekeeper.authz\n\ndefault allow = false\n\nallow {\n    input.user.roles[_] == "admin"\n}`}
                            spellCheck={false}
                        />
                        <div className="flex items-center gap-3">
                            <Button type="submit" isLoading={opaSaving} disabled={!opaPolicy.trim()}
                                className="bg-amber-500 hover:bg-amber-600 text-white border-amber-600">
                                Deploy Policy
                            </Button>
                            {opaStatus && (
                                <div className={`flex items-center gap-2 text-sm font-medium ${opaStatus.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                                    {opaStatus.ok ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                                    {opaStatus.message}
                                </div>
                            )}
                        </div>
                    </form>
                </CardContent>
            </Card>

            {/* Policy list */}
            <div className="space-y-3">
                {policies.map(policy => (
                    <Card key={policy.id} className="group hover:shadow-md transition-shadow">
                        <CardContent className="p-5">
                            <div className="flex items-start justify-between">
                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5 h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                                        {policy.allow_any_authenticated
                                            ? <Globe className="h-4 w-4 text-emerald-500" />
                                            : <Shield className="h-4 w-4 text-brand-500" />}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-sm font-semibold text-slate-900">{policy.name}</span>
                                            {!policy.is_active && <Badge variant="warning">Inactive</Badge>}
                                            <span className="text-[10px] text-slate-400 font-medium">Priority {policy.priority}</span>
                                        </div>
                                        <code className="text-xs text-brand-600 bg-brand-50 px-2 py-0.5 rounded-md border border-brand-100 font-mono">{policy.pattern}</code>
                                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                                            {policy.allow_any_authenticated ? (
                                                <Badge variant="success">Any authenticated user</Badge>
                                            ) : policy.roles.length > 0 ? (
                                                policy.roles.map(r => <Badge key={r} variant="default">Role: {r}</Badge>)
                                            ) : (
                                                <Badge variant="error">Deny all — no roles configured</Badge>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <Button
                                    variant="ghost" size="icon"
                                    className="h-8 w-8 text-slate-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                    onClick={() => handleDelete(policy.name)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
                {policies.length === 0 && !loading && (
                    <Card className="flex flex-col items-center justify-center py-16 border-dashed">
                        <ShieldAlert className="h-10 w-10 text-slate-300 mb-3" />
                        <p className="font-medium text-slate-600">No policies defined</p>
                        <p className="text-sm text-slate-400 mt-1">Create a policy to start enforcing route-level access control.</p>
                    </Card>
                )}
            </div>
        </PageLayout>
    );
}
