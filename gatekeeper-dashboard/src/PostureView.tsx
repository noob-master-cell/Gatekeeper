import React, { useEffect, useState } from 'react';
import { ShieldAlert, Plus, Trash2, Smartphone, Monitor, Globe } from 'lucide-react';
import { fetchPostureRules, createPostureRule, deletePostureRule, type DevicePostureRule } from './api';
import { PageHeader, PageLayout } from './components/ui/PageLayout';
import { Card, CardContent } from './components/ui/Card';
import { Badge } from './components/ui/Badge';
import { Button } from './components/ui/Button';
import { Skeleton } from './components/ui/Skeleton';

export default function PostureView() {
    const [rules, setRules] = useState<DevicePostureRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [isAdding, setIsAdding] = useState(false);
    const [newRuleType, setNewRuleType] = useState('ip_address');
    const [newValue, setNewValue] = useState('');
    const [newDescription, setNewDescription] = useState('');

    const loadRules = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await fetchPostureRules();
            setRules(data);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch posture rules');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadRules();
    }, []);

    const handleDelete = async (ruleId: number) => {
        if (!window.confirm('Are you sure you want to delete this posture rule?')) return;
        try {
            await deletePostureRule(ruleId);
            await loadRules();
        } catch (err: any) {
            alert(err.message || 'Failed to delete posture rule');
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newValue.trim()) return;
        try {
            await createPostureRule({
                rule_type: newRuleType,
                value: newValue.trim(),
                action: 'block', // Default for now
                is_active: true,
                description: newDescription.trim() || null
            });
            setIsAdding(false);
            setNewValue('');
            setNewDescription('');
            await loadRules();
        } catch (err: any) {
            alert(err.message || 'Failed to create posture rule');
        }
    };

    const getIconForRuleType = (type: string) => {
        switch (type) {
            case 'ip_address':
                return <Globe className="h-5 w-5 text-black" />;
            case 'user_agent':
                return <Monitor className="h-5 w-5 text-black" />;
            default:
                return <Smartphone className="h-5 w-5 text-black" />;
        }
    };

    if (loading && rules.length === 0) {
        return (
            <PageLayout>
                <PageHeader title="Device Posture" description="Manage network and device access rules." />
                <div className="space-y-4">
                    <Skeleton className="h-[120px] w-full" />
                    <Skeleton className="h-[120px] w-full" />
                </div>
            </PageLayout>
        );
    }

    return (
        <PageLayout>
            <PageHeader
                title="Device Posture Policies"
                description="Manage global device access rules, such as IP blocking and User-Agent restrictions before authentication."
                action={
                    <Button onClick={() => setIsAdding(!isAdding)} variant={isAdding ? 'default' : 'secondary'}>
                        <Plus className="mr-2 h-4 w-4" />
                        {isAdding ? 'Cancel' : 'New Rule'}
                    </Button>
                }
            />

            {error && (
                <div className="rounded-md bg-red-500/10 p-4 border border-red-500/20 mb-6">
                    <p className="text-sm text-red-500">{error}</p>
                </div>
            )}

            {isAdding && (
                <Card className="mb-8 border-2 border-surface-700 shadow-te font-sans">
                    <CardContent className="p-6">
                        <h3 className="text-lg font-medium text-white mb-4">Add Device Posture Rule</h3>
                        <form onSubmit={handleCreate} className="space-y-4 max-w-xl">
                            <div className="space-y-2 flex flex-col">
                                <label className="text-sm text-gray-400">Rule Type</label>
                                <select
                                    className="w-full rounded-none bg-surface-900 border-2 border-surface-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500 focus:ring-0 shadow-te-sm"
                                    value={newRuleType}
                                    onChange={e => setNewRuleType(e.target.value)}
                                >
                                    <option value="ip_address">Block IP Address</option>
                                    <option value="user_agent">Block User-Agent (Regex Match)</option>
                                </select>
                            </div>

                            <div className="space-y-2 flex flex-col">
                                <label className="text-sm text-gray-400">Match Value</label>
                                <input
                                    required
                                    value={newValue}
                                    onChange={e => setNewValue(e.target.value)}
                                    className="w-full rounded-none bg-surface-900 border-2 border-surface-700 px-3 py-2 text-sm text-brand-500 focus:outline-none focus:border-brand-500 font-mono shadow-te-sm tracking-wider"
                                    placeholder={newRuleType === 'ip_address' ? 'e.g. 203.0.113.5' : 'e.g. MSIE.*'}
                                />
                            </div>

                            <div className="space-y-2 flex flex-col">
                                <label className="text-sm text-gray-400">Description (Optional)</label>
                                <input
                                    value={newDescription}
                                    onChange={e => setNewDescription(e.target.value)}
                                    className="w-full rounded-none bg-surface-900 border-2 border-surface-700 px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500 shadow-te-sm"
                                    placeholder="e.g. Known malicious actor"
                                />
                            </div>

                            <div className="pt-4 flex justify-end">
                                <Button type="submit">Save Rule</Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {rules.map((rule) => (
                    <Card key={rule.id} className="group hover:-translate-y-1 hover:shadow-[4px_4px_0px_#ff6b00] hover:border-brand-500 transition-all duration-200">
                        <CardContent className="p-0">
                            <div className="flex items-start justify-between p-5">

                                {/* Left side: Icon & Details */}
                                <div className="flex items-start gap-3">
                                    <div className="mt-1 shrink-0 bg-brand-500 p-2 border-2 border-surface-950 shadow-te-sm">
                                        {getIconForRuleType(rule.rule_type)}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <Badge variant="outline" className="text-[10px] uppercase bg-surface-950 border-gray-800 text-gray-400 whitespace-nowrap">
                                                {rule.rule_type.replace('_', ' ')}
                                            </Badge>
                                            <Badge variant="error" className="bg-red-500 text-black border-2 border-surface-950 px-2 shadow-te-sm">BLOCK</Badge>
                                        </div>
                                        <h3 className="text-brand-500 font-mono font-bold text-sm mt-3 break-all bg-surface-950 px-2 py-1 border-2 border-surface-700 shadow-te-sm inline-block">{rule.value}</h3>
                                        {rule.description && (
                                            <p className="text-sm text-gray-500 mt-1 line-clamp-2">{rule.description}</p>
                                        )}
                                    </div>
                                </div>

                                {/* Right side: Actions */}
                                <div className="ml-2 flex flex-col items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-400/10 shrink-0"
                                        onClick={() => handleDelete(rule.id)}
                                        title="Delete Rule"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>

                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {rules.length === 0 && !loading && (
                <div className="text-center py-12 border border-dashed border-gray-800 rounded-lg">
                    <ShieldAlert className="mx-auto h-8 w-8 text-gray-600 mb-3" />
                    <h3 className="text-gray-400 font-medium">No Posture Rules Found</h3>
                    <p className="text-sm text-gray-500 mt-1">Add rules to block specific IP addresses or User-Agents globally.</p>
                </div>
            )}
        </PageLayout>
    );
}
