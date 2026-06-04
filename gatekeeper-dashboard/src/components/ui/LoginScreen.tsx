import { ShieldCheck, Lock, Fingerprint, Eye, ArrowRight, FlaskConical } from 'lucide-react';
import { Button } from './Button';

export function LoginScreen() {
    const handleLogin = () => {
        window.location.href = '/login';
    };

    const handleDemo = () => {
        window.location.href = '/auth/demo';
    };

    return (
        <div className="flex min-h-screen w-full bg-slate-50 font-sans">
            {/* Left side — branding panel */}
            <div className="hidden lg:flex lg:w-5/12 flex-col items-center justify-center bg-white border-r border-slate-200 p-12 relative overflow-hidden">
                {/* Subtle dot grid */}
                <div
                    className="absolute inset-0 opacity-40"
                    style={{
                        backgroundImage: 'radial-gradient(circle, #e2e8f0 1px, transparent 1px)',
                        backgroundSize: '24px 24px',
                    }}
                />

                <div className="relative z-10 flex flex-col items-center gap-8 max-w-xs w-full">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500 shadow-lg">
                        <ShieldCheck className="h-8 w-8 text-white" />
                    </div>

                    <div className="text-center">
                        <h1 className="text-2xl font-bold text-slate-900">Gatekeeper</h1>
                        <p className="mt-1.5 text-sm text-slate-500">Zero-Trust Infrastructure Platform</p>
                    </div>

                    <div className="w-full space-y-2.5 mt-2">
                        {[
                            { icon: Lock,        label: 'Identity-aware proxy routing' },
                            { icon: Fingerprint, label: 'Mutual TLS encryption' },
                            { icon: Eye,         label: 'Real-time audit logging' },
                        ].map((f, i) => (
                            <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-slate-50 border border-slate-100">
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-50">
                                    <f.icon className="h-3.5 w-3.5 text-brand-500" />
                                </div>
                                <span className="text-sm text-slate-600">{f.label}</span>
                            </div>
                        ))}
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                        <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-dot" />
                        <span className="text-xs text-slate-400">All connections encrypted end-to-end</span>
                    </div>
                </div>
            </div>

            {/* Right side — login form */}
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
                <div className="w-full max-w-sm">
                    {/* Mobile logo */}
                    <div className="flex lg:hidden flex-col items-center gap-3 mb-10">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500">
                            <ShieldCheck className="h-6 w-6 text-white" />
                        </div>
                        <h1 className="text-xl font-bold text-slate-900">Gatekeeper</h1>
                    </div>

                    <div className="space-y-6">
                        <div>
                            <h2 className="text-2xl font-semibold text-slate-900">Welcome back</h2>
                            <p className="mt-1.5 text-sm text-slate-500">
                                Sign in to access the administration dashboard.
                            </p>
                        </div>

                        <div className="p-6 rounded-xl border border-slate-200 bg-white shadow-sm space-y-4">
                            <Button
                                variant="default"
                                size="lg"
                                className="w-full justify-center gap-3"
                                onClick={handleLogin}
                            >
                                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
                                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                                </svg>
                                Continue with Google
                                <ArrowRight className="h-4 w-4 ml-auto opacity-60" />
                            </Button>

                            <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-slate-100" />
                                </div>
                                <div className="relative flex justify-center text-xs">
                                    <span className="bg-white px-2 text-slate-400">or</span>
                                </div>
                            </div>

                            <Button
                                variant="outline"
                                size="lg"
                                className="w-full justify-center gap-3"
                                onClick={handleDemo}
                            >
                                <FlaskConical className="h-4 w-4 text-amber-500" />
                                View Demo
                                <ArrowRight className="h-4 w-4 ml-auto opacity-60" />
                            </Button>

                            <p className="text-center text-xs text-slate-400">
                                By signing in, you agree to the access policies enforced by this gateway.
                            </p>
                        </div>

                        <p className="text-center text-xs text-slate-400">
                            Access is restricted to authorized personnel only.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
