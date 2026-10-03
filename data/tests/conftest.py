import os
import sys
from pathlib import Path

# Tests never call the real API; individual tests opt back in with a mocked client.
os.environ["HOLDLESS_LLM"] = "off"
os.environ.pop("TIGER_DATABASE_URL", None)
os.environ.pop("SNOWFLAKE_ACCOUNT", None)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
