import React, { useEffect, useState } from 'react';
import { ShieldAlert, Plus, Trash2, Shield, Globe } from 'lucide-react';
import { fetchPolicies, createPolicy, deletePolicy, simulatePolicy, type Policy, type PolicySimulationResponse } from './api';
import { PageHeader, PageLayout } from './components/ui/PageLayout';
import { Card, CardContent } from './components/ui/Card';
import { Badge } from './components/ui/Badge';
import { Button } from './components/ui/Button';
import { Skeleton } from './components/ui/Skeleton';

export default function PoliciesView() {
    const [policies, setPolicies] = useState<Policy[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Basic mock form state for new policy (could be expanded to a real modal)
    const [isAdding, setIsAdding] = useState(false);
    const [newPolicyName, setNewPolicyName] = useState('');
    const [newPolicyPattern, setNewPolicyPattern] = useState('');
    const [newPolicyPriority, setNewPolicyPriority] = useState('100');
    const [newPolicyRoles, setNewPolicyRoles] = useState('admin,hr');
    const [newPolicyAnyAuth, setNewPolicyAnyAuth] = useState(false);

    // Simulator State
    const [simEmail, setSimEmail] = useState('test@user.com');
    const [simRoles, setSimRoles] = useState('hr');
    const [simPath, setSimPath] = useState('/api/hr/salary');
    const [simResult, setSimResult] = useState<PolicySimulationResponse | null>(null);
    const [simulating, setSimulating] = useState(false);

    const handleSimulate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setSimulating(true);
            setSimResult(null);
            const res = await simulatePolicy({
                email: simEmail,
                roles: simRoles.split(',').map(r => r.trim()).filter(Boolean),
                path: simPath,
                method: 'GET'
            });
            setSimResult(res);
        } catch (err: any) {
            alert(err.message || 'Simulation failed');
        } finally {
            setSimulating(false);
        }
    };

    const loadPolicies = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await fetchPolicies();
            setPolicies(data);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch policies');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadPolicies();
    }, []);

    const handleDelete = async (name: string) => {
        if (!window.confirm(`Are you sure you want to delete policy '${name}'?`)) return;
        try {
            await deletePolicy(name);
            await loadPolicies();
        } catch (err: any) {
            alert(err.message || 'Failed to delete policy');
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await createPolicy({
                name: newPolicyName,
                pattern: newPolicyPattern,
                priority: parseInt(newPolicyPriority, 10),
                allow_any_authenticated: newPolicyAnyAuth,
                roles: newPolicyAnyAuth ? [] : newPolicyRoles.split(',').map(r => r.trim()).filter(Boolean),
                is_active: true
            });
            setIsAdding(false);
            setNewPolicyName('');
            setNewPolicyPattern('');
            setNewPolicyAnyAuth(false);
            await loadPolicies();
        } catch (err: any) {
            alert(err.message || 'Failed to create policy');
        }
    };

    if (loading && policies.length === 0) {
        return (
            <PageLayout>
                <PageHeader title="Access Policies" description="Manage route-level RBAC rules." />
                <div className="space-y-4">
                    <Skeleton className="h-[200px] w-full" />
                    <Skeleton className="h-[200px] w-full" />
                </div>
            </PageLayout>
        );
    }

    return (
        <PageLayout>
            <PageHeader
                title="Access Policies"
                description="Manage the zero-trust route policies and role requirements."
                action={
                    <Button onClick={() => setIsAdding(!isAdding)} variant={isAdding ? 'default' : 'secondary'}>
                        <Plus className="mr-2 h-4 w-4" />
                        {isAdding ? 'Cancel' : 'New Policy'}
                    </Button>
                }
            />

            {error && (
                <div className="rounded-md bg-red-500/10 p-4 border border-red-500/20 mb-6">
                    <p className="text-sm text-red-500">{error}</p>
                </div>
            )}

            {isAdding && (
                <Card className="mb-8 border-2 border-surface-700 shadow-te">
                    <CardContent className="p-6">
                        <h3 className="text-lg font-medium text-white mb-4">Create New Route Policy</h3>
                        <form onSubmit={handleCreate} className="space-y-4 max-w-2xl">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm text-gray-400">Policy Name</label>
                                    <input
                                        required
                                        value={newPolicyName}
                                        onChange={e => setNewPolicyName(e.target.value)}
                                        className="w-full rounded-none bg-surface-900 border-2 border-surface-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500 focus:ring-0 shadow-te-sm font-mono"
                                        placeholder="e.g. Finance API"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm text-gray-400">Route Regex Pattern</label>
                                    <input
                                        required
                                        value={newPolicyPattern}
                                        onChange={e => setNewPolicyPattern(e.target.value)}
                                        className="w-full rounded-none bg-surface-900 border-2 border-surface-700 px-3 py-2 text-sm text-brand-500 focus:outline-none focus:border-brand-500 focus:ring-0 shadow-te-sm font-mono tracking-wider"
                                        placeholder="^/api/finance(/.*)?$"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm text-gray-400">Priority (lower is first)</label>
                                    <input
                                        required
                                        type="number"
                                        value={newPolicyPriority}
                                        onChange={e => setNewPolicyPriority(e.target.value)}
                                        className="w-full rounded-none bg-surface-900 border-2 border-surface-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500 focus:ring-0 shadow-te-sm font-mono"
                                    />
                                </div>
                                <div className="space-y-2 col-span-2">
                                    <label className="text-sm text-gray-400">Required Roles (comma separated)</label>
                                    <input
                                        disabled={newPolicyAnyAuth}
                                        value={newPolicyRoles}
                                        onChange={e => setNewPolicyRoles(e.target.value)}
                                        className="w-full rounded-none bg-surface-900 border-2 border-surface-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500 focus:ring-0 shadow-te-sm font-mono disabled:opacity-50"
                                        placeholder="admin, hr"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-2 pt-2">
                                    <input
                                        type="checkbox"
                                        id="anyAuth"
                                        checked={newPolicyAnyAuth}
                                        onChange={e => setNewPolicyAnyAuth(e.target.checked)}
                                        className="rounded-none border-2 border-surface-700 bg-surface-900 text-brand-500 focus:ring-brand-500 focus:ring-offset-surface-950 h-5 w-5"
                                    />
                                    <label htmlFor="anyAuth" className="text-sm font-bold uppercase tracking-widest text-gray-300">Allow ANY Authenticated (Bypass RBAC)</label>
                            </div>

                            <div className="pt-4 flex justify-end">
                                <Button type="submit">Save Policy</Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            )}

            {/* SIMULATOR SANDBOX */}
            <Card className="mb-8 border-2 border-surface-700 shadow-te bg-surface-950">
                <CardContent className="p-0">
                    <div className="flex border-b-2 border-surface-700 bg-surface-900 px-6 py-4 items-center gap-3">
                        <ShieldAlert className="h-5 w-5 text-brand-400" />
                        <h3 className="text-lg font-bold text-white uppercase tracking-widest">Diagnostic Sandbox</h3>
                    </div>
                    
                    <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                            <p className="text-gray-400 text-sm mb-4">Test if a hypothetical user would be allowed to access a given URL path under the current routing policies.</p>
                            <form onSubmit={handleSimulate} className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-xs font-mono text-gray-400 uppercase">Mock Email</label>
                                        <input required value={simEmail} onChange={e => setSimEmail(e.target.value)} className="w-full bg-surface-800 border-2 border-surface-700 px-3 py-2 text-sm text-white focus:border-brand-500 outline-none font-mono" />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-mono text-gray-400 uppercase">Mock Roles</label>
                                        <input required value={simRoles} onChange={e => setSimRoles(e.target.value)} className="w-full bg-surface-800 border-2 border-surface-700 px-3 py-2 text-sm text-white focus:border-brand-500 outline-none font-mono" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-mono text-gray-400 uppercase">Target Path</label>
                                    <input required value={simPath} onChange={e => setSimPath(e.target.value)} className="w-full bg-surface-800 border-2 border-surface-700 px-3 py-2 text-sm text-brand-400 font-bold tracking-wider focus:border-brand-500 outline-none font-mono" placeholder="e.g. /api/admin" />
                                </div>
                                <Button type="submit" variant="secondary" isLoading={simulating} className="w-full border-2 border-surface-700 hover:bg-surface-700 text-white shadow-te">
                                    EXECUTE_SIMULATION
                                </Button>
                            </form>
                        </div>
                        
                        {/* Simulation Result Terminal */}
                        <div className="bg-black border-2 border-surface-700 p-4 font-mono text-sm relative overflow-hidden flex flex-col justify-center min-h-[160px]">
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,229,255,0.03)_0%,transparent_100%)] pointer-events-none"></div>
                            {!simResult ? (
                                <div className="text-gray-600 flex items-center gap-2">
                                    <div className="w-2 h-4 bg-brand-400 animate-pulse"></div> waiting for input...
                                </div>
                            ) : (
                                <div className="space-y-2 relative z-10">
                                    <div className="flex items-center gap-2 mb-4 text-xs">
                                        <span className={`px-2 py-0.5 font-bold tracking-widest ${simResult.allowed ? 'bg-emerald-500 text-black shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-red-500 text-black shadow-[0_0_10px_rgba(239,68,68,0.5)]'}`}>
                                            {simResult.allowed ? 'ACCESS GRANTED' : 'ACCESS DENIED'}
                                        </span>
                                    </div>
                                    <div className="text-gray-400 tracking-wider">
                                        <span className="text-brand-500 opacity-70">USER |</span> <span className="text-white">{simResult.email}</span> [{simResult.simulated_roles.join(', ')}]<br/>
                                        <span className="text-brand-500 opacity-70">PATH |</span> <span className="text-white">{simResult.path}</span><br/>
                                        <span className="text-brand-500 opacity-70">RULE |</span> <span className={simResult.allowed ? "text-emerald-400" : "text-red-400"}>{simResult.reason}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="space-y-4">
                {policies.map((policy) => (
                    <Card key={policy.id} className="group hover:-translate-y-1 hover:shadow-[4px_4px_0px_#ff6b00] hover:border-brand-500 transition-all duration-200">
                        <CardContent className="p-0">
                            <div className="flex items-center justify-between p-6">

                                {/* Left side: Icon & Details */}
                                <div className="flex items-start gap-4">
                                    <div className="mt-1 shrink-0 bg-surface-800 p-2 border-2 border-surface-700 shadow-te-sm">
                                        {policy.allow_any_authenticated ? (
                                            <Globe className="h-5 w-5 text-emerald-400" />
                                        ) : (
                                            <Shield className="h-5 w-5 text-brand-400" />
                                        )}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-3">
                                            <h3 className="text-white font-medium text-lg">{policy.name}</h3>
                                            {!policy.is_active && <Badge variant="warning">Inactive</Badge>}
                                            <Badge variant="outline" className="text-xs font-mono bg-surface-950 px-2 py-0.5 border-gray-800 text-gray-400">
                                                Pri: {policy.priority}
                                            </Badge>
                                        </div>

                                        <div className="mt-2 flex items-center gap-2 font-mono text-sm text-gray-500">
                                            <span className="bg-surface-950 px-3 py-1 border-2 border-surface-700 text-brand-500 shadow-te-sm font-bold tracking-wider">
                                                {policy.pattern}
                                            </span>
                                        </div>

                                        <div className="mt-4 flex flex-wrap gap-2">
                                            {policy.allow_any_authenticated ? (
                                                <Badge variant="success" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                                                    Any Authenticated User
                                                </Badge>
                                            ) : policy.roles.length > 0 ? (
                                                policy.roles.map(r => (
                                                    <Badge key={r} variant="default" className="capitalize">
                                                        Role: {r}
                                                    </Badge>
                                                ))
                                            ) : (
                                                <Badge variant="error" className="bg-red-500/10 text-red-500 border-red-500/20">
                                                    DENY ALL (No roles configured)
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Right side: Actions */}
                                <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-400/10"
                                        onClick={() => handleDelete(policy.name)}
                                        title="Delete Policy"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>

                            </div>
                        </CardContent>
                    </Card>
                ))}
                {policies.length === 0 && !loading && (
                    <div className="text-center py-12 border border-dashed border-gray-800 rounded-lg">
                        <ShieldAlert className="mx-auto h-8 w-8 text-gray-600 mb-3" />
                        <h3 className="text-gray-400 font-medium">No Route Policies Found</h3>
                        <p className="text-sm text-gray-500 mt-1">Create a policy to start enforcing access control.</p>
                    </div>
                )}
            </div>
        </PageLayout>
    );
}
