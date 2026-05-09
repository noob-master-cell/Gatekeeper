import '@testing-library/jest-dom';

// jsdom does not implement EventSource — stub it so components that use SSE don't throw
class EventSourceStub {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSED = 2;
    readyState = 0;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    constructor(public url: string) {}
    addEventListener() {}
    removeEventListener() {}
    close() { this.readyState = 2; }
}

vi.stubGlobal('EventSource', EventSourceStub);
