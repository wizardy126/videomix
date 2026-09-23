#!/usr/bin/env python3
# T09 spike helper: runs a command and prints wall time, CPU time and peak RSS of the child as one JSON line on
# stderr (prefixed with "MEASURE "). Used by renderSpike.ts because there is no /usr/bin/time in the sandbox.
import json
import resource
import subprocess
import sys
import time

start = time.monotonic()
proc = subprocess.run(sys.argv[1:], check=False)
wall = time.monotonic() - start
usage = resource.getrusage(resource.RUSAGE_CHILDREN)
print('MEASURE ' + json.dumps({
    'exitCode': proc.returncode,
    'wallSec': round(wall, 3),
    'cpuSec': round(usage.ru_utime + usage.ru_stime, 3),
    'maxRssMb': round(usage.ru_maxrss / 1024, 1),
}), file=sys.stderr)
sys.exit(proc.returncode)
