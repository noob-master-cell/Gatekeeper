-- Token Bucket Rate Limiter
-- Executed atomically via EVALSHA — no race conditions possible.
--
-- KEYS[1]  bucket key
-- ARGV[1]  capacity      (max tokens, integer)
-- ARGV[2]  refill_rate   (tokens per second, float)
-- ARGV[3]  now_ms        (current Unix time in milliseconds)
-- ARGV[4]  requested     (tokens to consume, usually 1)
--
-- Returns: {allowed, remaining_tokens, retry_after_ms}
--   allowed:        1 = request allowed, 0 = denied
--   remaining:      integer tokens left after this request
--   retry_after_ms: milliseconds until 1 token refills (0 if allowed)

local key      = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local now_ms   = tonumber(ARGV[3])
local need     = tonumber(ARGV[4])

local stored  = redis.call('HMGET', key, 'tokens', 'ts')
local tokens  = tonumber(stored[1])
local last_ms = tonumber(stored[2])

if not tokens then
    tokens  = capacity
    last_ms = now_ms
end

-- Refill proportional to elapsed time, capped at capacity
local elapsed_s = math.max(0, (now_ms - last_ms) / 1000.0)
tokens = math.min(capacity, tokens + elapsed_s * rate)

local allowed, retry_ms
if tokens >= need then
    tokens   = tokens - need
    allowed  = 1
    retry_ms = 0
else
    local deficit = need - tokens
    retry_ms      = math.ceil((deficit / rate) * 1000)
    allowed       = 0
end

local ttl_s = math.ceil(capacity / rate) + 5
redis.call('HSET',   key, 'tokens', tokens, 'ts', now_ms)
redis.call('EXPIRE', key, ttl_s)

return {allowed, math.floor(tokens), retry_ms}
