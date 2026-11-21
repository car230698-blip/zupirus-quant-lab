"""AI Research Engine — Re-export shim for backwards compatibility.
Implementation is housed in app.domains.ai.research_graph.
"""
from app.domains.ai.research_graph import *  # noqa: F403,F401
from app.domains.ai.research_graph import main as _main

if __name__ == '__main__':
    _main()
