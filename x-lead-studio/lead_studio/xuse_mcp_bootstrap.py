"""Start the pinned x-use MCP server with the local reply preview compatibility."""

import runpy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lead_studio.xuse_compat import install_xuse_reply_preview_compatibility

install_xuse_reply_preview_compatibility()
runpy.run_module("xuse.mcp.server", run_name="__main__")
