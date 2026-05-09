import { vi } from 'vitest';
import '@testing-library/jest-dom';

// jsdom does not implement EventSource — stub it so SSE-using components don't throw
function EventSourceStub(this: { readyState: number; onopen: null; onerror: null; onmessage: null; url: string }, url: string) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onerror = null;
    this.onmessage = null;
}
EventSourceStub.prototype.addEventListener = () => {};
EventSourceStub.prototype.removeEventListener = () => {};
EventSourceStub.prototype.close = function () { this.readyState = 2; };
EventSourceStub.CONNECTING = 0;
EventSourceStub.OPEN = 1;
EventSourceStub.CLOSED = 2;

vi.stubGlobal('EventSource', EventSourceStub);
