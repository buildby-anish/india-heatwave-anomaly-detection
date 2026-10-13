import os
import tempfile

# Keep test hazard edits away from the real state folder. Must be set before app.config is imported.
os.environ["HEATWAVE_STATE_DIR"] = tempfile.mkdtemp(prefix="hw-test-")
