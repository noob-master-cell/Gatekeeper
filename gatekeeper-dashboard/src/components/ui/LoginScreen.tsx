import { ShieldCheck, LogIn, Lock, Fingerprint, Eye } from 'lucide-react';
import { Button } from './Button';

export function LoginScreen() {
    const handleLogin = () => {
        window.location.href = '/login';
    };

    return (
        <div className="flex h-screen w-screen bg-surface-950 font-sans text-gray-100">
            {/* Left Panel - Branding */}
            <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center bg-surface-900 border-r-2 border-surface-700 relative overflow-hidden">
                {/* Background grid pattern */}
                <div className="absolute inset-0 opacity-[0.03]"
                    style={{
                        backgroundImage: 'linear-gradient(rgba(255,58,32,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,58,32,0.3) 1px, transparent 1px)',
                        backgroundSize: '40px 40px'
                    }}
                />

                <div className="relative z-10 flex flex-col items-center gap-8 px-12">
                    <div className="flex h-24 w-24 items-center justify-center bg-brand-500 border-4 border-surface-950 shadow-te">
                        <ShieldCheck className="h-12 w-12 text-black" />
                    </div>

                    <div className="text-center">
                        <h1 className="text-4xl font-bold uppercase tracking-tight text-white">Gatekeeper</h1>
                        <p className="mt-2 text-sm font-bold uppercase tracking-[0.3em] text-surface-700">Zero-Trust Infrastructure</p>
                    </div>

                    <div className="mt-8 flex flex-col gap-4 w-full max-w-xs">
                        {[
                            { icon: Lock, text: 'Identity-Aware Routing' },
                            { icon: Fingerprint, text: 'Mutual TLS Encryption' },
                            { icon: Eye, text: 'Real-Time Observability' },
                        ].map((feature, i) => (
                            <div key={i} className="flex items-center gap-3 px-4 py-3 bg-surface-800 border-2 border-surface-700">
                                <feature.icon className="h-4 w-4 text-brand-500 shrink-0" />
                                <span className="text-xs font-bold uppercase tracking-widest text-gray-400">{feature.text}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Right Panel - Login */}
            <div className="flex flex-1 flex-col items-center justify-center px-8">
                <div className="w-full max-w-sm">
                    {/* Mobile logo */}
                    <div className="flex lg:hidden flex-col items-center gap-4 mb-12">
                        <div className="flex h-16 w-16 items-center justify-center bg-brand-500 border-4 border-surface-950 shadow-te">
                            <ShieldCheck className="h-8 w-8 text-black" />
                        </div>
                        <h1 className="text-2xl font-bold uppercase tracking-tight text-white">Gatekeeper</h1>
                    </div>

                    <div className="flex flex-col gap-6">
                        <div>
                            <h2 className="text-xl font-bold uppercase tracking-wider text-white">Mission Control</h2>
                            <p className="mt-1 text-xs font-bold uppercase tracking-widest text-surface-700">Authentication Required</p>
                        </div>

                        <div className="border-2 border-surface-700 bg-surface-900 p-6">
                            <p className="text-sm text-gray-400 mb-6 leading-relaxed">
                                Sign in with your Google Workspace account to access the administration dashboard.
                            </p>

                            <Button
                                variant="default"
                                size="lg"
                                className="w-full gap-3 text-sm"
                                onClick={handleLogin}
                            >
                                <LogIn className="h-5 w-5" />
                                Sign In with Google
                            </Button>
                        </div>

                        <div className="flex items-center gap-2 px-1">
                            <div className="h-2 w-2 bg-emerald-500 animate-pulse-dot" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-surface-700">
                                All connections encrypted · Zero-Trust enforced
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
