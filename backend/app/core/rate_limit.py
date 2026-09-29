from slowapi import Limiter
from slowapi.util import get_remote_address

# Keyed by client IP. Compile/run are the expensive, abusable endpoints
# (each spawns a real compiler + subprocess) -- see spec section 52
# ("Rate Limiting") and security requirement #13 ("Rate-limit compiler
# requests"). Limits are deliberately generous for normal classroom use
# (a student iterating on one program) while still bounding worst-case load
# from a single source hammering the API.
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
