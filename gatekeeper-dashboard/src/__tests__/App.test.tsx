import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function authMeOk(user = { sub: 'u1', email: 'admin@test.local', roles: ['admin'], jti: 'jti-1' }) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(user) } as Response);
}

function authMeUnauthed() {
    return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) } as Response);
}

beforeEach(() => {
    mockFetch.mockReset();
});

describe('App', () => {
    it('shows loading spinner while /auth/me is in-flight', () => {
        // Never resolve so we stay in loading state
        mockFetch.mockReturnValueOnce(new Promise(() => {}));
        render(<App />);
        expect(screen.getByText('Authenticating...')).toBeInTheDocument();
    });

    it('shows login screen when /auth/me returns non-ok', async () => {
        mockFetch.mockReturnValueOnce(authMeUnauthed());
        render(<App />);
        await waitFor(() => {
            // LoginScreen renders a sign-in button or heading
            expect(screen.getByText(/sign in/i)).toBeInTheDocument();
        });
    });

    it('renders the dashboard when authenticated', async () => {
        mockFetch.mockReturnValueOnce(authMeOk());
        // Subsequent fetches (admin/status, health, traffic, etc.) return minimal ok
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as Response);

        render(<App />);
        await waitFor(() => {
            // Sidebar navigation should be visible
            expect(screen.getByText(/overview/i)).toBeInTheDocument();
        });
    });

    it('shows user email in the topbar after login', async () => {
        mockFetch.mockReturnValueOnce(authMeOk({ sub: 'u1', email: 'dheeraj@test.local', roles: ['admin'], jti: 'j1' }));
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as Response);

        render(<App />);
        await waitFor(() => {
            expect(screen.getByText('dheeraj@test.local')).toBeInTheDocument();
        });
    });
});
