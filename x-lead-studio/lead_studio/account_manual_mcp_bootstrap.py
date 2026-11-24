"""Launch the restricted adapter through the same Python/MCP environment."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lead_studio.account_manual_mcp import main

main()
