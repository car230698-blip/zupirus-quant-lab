"""Execution Engine — Re-export shim for backwards compatibility.
Implementation is housed in app.domains.execution.engine.
"""
from app.domains.execution.engine import *  # noqa: F403,F401
from app.domains.execution.engine import main as _main

if __name__ == '__main__':
    _main()
