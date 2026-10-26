"""Extract exact MaleCNS transmitter rows; build dependency: pyarrow==26.0.0."""
import json
import sys
from pathlib import Path

# Optional project-local build dependencies; no Python is required by the app.
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / ".cache" / "python-deps"))
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.feather as feather

source, identities = map(Path, sys.argv[1:3])
ids = json.loads(identities.read_text(encoding="utf-8"))
columns = ["body", "consensus_nt", "predicted_nt", "predicted_nt_confidence",
           "total_nt_predictions", "ground_truth", "celltype_predicted_nt",
           "celltype_predicted_nt_confidence", "celltype_total_nt_predictions", "cell_type"]
table = feather.read_table(source, columns=columns)
selected = table.filter(pc.is_in(table["body"], value_set=pa.array(ids, type=pa.int64())))
rows = sorted(selected.to_pylist(), key=lambda row: row["body"])
if len(rows) != len(ids) or {row["body"] for row in rows} != set(ids):
    raise ValueError("Missing or duplicate body ID in neurotransmitter source")
print(json.dumps({"sourceRows": table.num_rows, "pyarrow": pa.__version__, "columns": columns,
                  "records": [[row[column] for column in columns] for row in rows]},
                 allow_nan=False, separators=(",", ":")))
