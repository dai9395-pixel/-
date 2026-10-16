"""Copy public assets only; credentials and SQLite files never enter the output."""
import shutil
from pathlib import Path
root=Path(__file__).resolve().parents[1]
destination=root/'dist'
if destination.exists():shutil.rmtree(destination)
shutil.copytree(root/'public',destination)
# Tell the frontend this build requires authenticated API access.
(destination/'runtime.json').write_text('{"authentication":true}',encoding='utf-8')
print('Built static assets in dist/')
