#!/bin/sh
# gdb's `set exec-wrapper` runs this in place of directly exec'ing the
# debuggee, so the resource limits applied here land on the debuggee only
# -- gdb itself (which needs real memory/time to load symbols) stays
# unconstrained. Values come from env vars set by gdb_session.py (derived
# from the same RUN_CPU_SECONDS/RUN_MEMORY_BYTES/RUN_MAX_FILE_SIZE_BYTES
# used for the plain, non-debug run path -- see core/config.py), not
# hardcoded here, so this script doesn't need per-session regeneration.
ulimit -t "${DEBUGGEE_CPU_SECONDS:-4}"
ulimit -v "${DEBUGGEE_MEM_KB:-262144}"
ulimit -f "${DEBUGGEE_FSIZE_KB:-10240}"
ulimit -c 0
exec "$@"
