import React, { useEffect, useRef, useState } from 'react';
import { ShieldAlert, Plus, Trash2, Smartphone, Monitor, Globe, X } from 'lucide-react';
import { fetchPostureRules, createPostureRule, deletePostureRule, type DevicePostureRule } from './api';
import { PageHeader, PageLayout } from './components/ui/PageLayout';
import { Card, CardContent } from './components/ui/Card';
import { Badge } from './components/ui/Badge';
import { Button } from './components/ui/Button';
import { Skeleton } from './components/ui/Skeleton';
import { errorMessage } from './lib/utils';

const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400';

export default function PostureView() {
    const [rules, setRules] = useState<DevicePostureRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isAdding, setIsAdding] = useState(false);
    const [newRuleType, setNewRuleType] = useState('ip_address');
    const [newValue, setNewValue] = useState('');
    const [newDescription, setNewDescription] = useState('');

    const mountedRef = useRef(true);
    useEffect(() => { return () => { mountedRef.current = false; }; }, []);

    const loadRules = async () => {
        try {
            setLoading(true); setError(null);
            const data = await fetchPostureRules();
            if (mountedRef.current) setRules(data);
        } catch (err) {
            if (mountedRef.current) setError(errorMessage(err, 'Failed to fetch rules'));
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    };

    useEffect(() => { loadRules(); }, []);

    const handleDelete = async (id: number) => {
        if (!window.confirm('Delete this posture rule?')) return;
        try { await deletePostureRule(id); await loadRules(); }
        catch (err) { alert(errorMessage(err, 'Delete failed')); }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newValue.trim()) return;
        try {
            await createPostureRule({ rule_type: newRuleType, value: newValue.trim(), action: 'block', is_active: true, description: newDescription.trim() || null });
            setIsAdding(false); setNewValue(''); setNewDescription('');
            await loadRules();
        } catch (err) { alert(errorMessage(err, 'Create failed')); }
    };

    const typeIcon = (type: string) => {
        if (type === 'ip_address') return <Globe className="h-4 w-4 text-blue-500" />;
        if (type === 'user_agent') return <Monitor className="h-4 w-4 text-amber-500" />;
        return <Smartphone className="h-4 w-4 text-slate-500" />;
    };

    if (loading && rules.length === 0) {
        return (
            <PageLayout>
                <PageHeader title="Device Posture" description="Network and device access rules" />
                <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
            </PageLayout>
        );
    }

    return (
        <PageLayout>
            <PageHeader
                title="Device Posture"
                description="Global device access rules applied before authentication"
                action={
                    <Button size="sm" variant={isAdding ? 'secondary' : 'default'} onClick={() => setIsAdding(!isAdding)}>
                        {isAdding ? <><X className="mr-1.5 h-4 w-4" /> Cancel</> : <><Plus className="mr-1.5 h-4 w-4" /> New Rule</>}
                    </Button>
                }
            />

            {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>
            )}

            {isAdding && (
                <Card className="mb-2">
                    <CardContent className="p-5">
                        <h3 className="text-sm font-semibold text-slate-900 mb-4">Add Posture Rule</h3>
                        <form onSubmit={handleCreate} className="space-y-4 max-w-lg">
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1.5">Rule Type</label>
                                <select value={newRuleType} onChange={e => setNewRuleType(e.target.value)} className={inputCls}>
                                    <option value="ip_address">Block IP Address</option>
                                    <option value="user_agent">Block User-Agent (regex)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1.5">Match Value</label>
                                <input required value={newValue} onChange={e => setNewValue(e.target.value)}
                                    className={inputCls} placeholder={newRuleType === 'ip_address' ? '203.0.113.5' : 'MSIE.*'} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1.5">Description (optional)</label>
                                <input value={newDescription} onChange={e => setNewDescription(e.target.value)}
                                    className={inputCls} placeholder="e.g. Known malicious IP" />
                            </div>
                            <div className="flex justify-end gap-2 pt-1">
                                <Button type="button" variant="ghost" size="sm" onClick={() => setIsAdding(false)}>Cancel</Button>
                                <Button type="submit" size="sm">Save Rule</Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {rules.map(rule => (
                    <Card key={rule.id} className="group hover:shadow-md transition-shadow">
                        <CardContent className="p-5">
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center">
                                        {typeIcon(rule.rule_type)}
                                    </div>
                                    <div>
                                        <Badge variant="outline" className="text-[10px]">
                                            {rule.rule_type.replace('_', ' ')}
                                        </Badge>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <Badge variant="error" className="text-[10px]">BLOCK</Badge>
                                    <Button
                                        variant="ghost" size="icon"
                                        className="h-7 w-7 text-slate-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => handleDelete(rule.id)}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>
                            <p className="text-sm font-mono text-brand-600 bg-brand-50 px-2.5 py-1.5 rounded-md border border-brand-100 break-all">{rule.value}</p>
                            {rule.description && (
                                <p className="text-xs text-slate-500 mt-2 line-clamp-2">{rule.description}</p>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>

            {rules.length === 0 && !loading && (
                <Card className="flex flex-col items-center justify-center py-16 border-dashed">
                    <ShieldAlert className="h-10 w-10 text-slate-300 mb-3" />
                    <p className="font-medium text-slate-600">No posture rules</p>
                    <p className="text-sm text-slate-400 mt-1">Add rules to block specific IPs or user agents.</p>
                </Card>
            )}
        </PageLayout>
    );
}
