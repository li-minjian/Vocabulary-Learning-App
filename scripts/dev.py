"""Start one local service using existing configuration, without editing .env."""
import argparse
import os
from pathlib import Path
import subprocess

from dotenv import dotenv_values

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('service', choices=['backend', 'frontend'])
parser.add_argument('--config-root', type=Path, help='Existing configured VOCA checkout; defaults to this checkout')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
config_root = args.config_root or root
directory = root / args.service
config_path = config_root / args.service / ('.env' if args.service == 'backend' else '.env.local')
env = os.environ.copy()
if config_path.is_file():
    for key, value in dotenv_values(config_path).items():
        if value is not None and (args.service == 'backend' or key.startswith('VITE_')):
            env[key] = value
if args.service == 'frontend':
    # Route local browser requests to the local backend, not the configured deployment.
    env['VITE_API_BASE_URL'] = 'http://127.0.0.1:5001'
    command = ['npm', 'run', 'dev', '--', '--host', 'localhost']
else:
    env['FLASK_DEBUG'] = 'false'
    command = [str(root / 'backend/.venv/bin/python'), 'app.py']
raise SystemExit(subprocess.call(command, cwd=directory, env=env))
