"""SQLite demo adapter with the same store/assignment contract as the cloud API."""
import json
import sqlite3
from lib.cloud_store import StoreError

class LocalStore:
    def __init__(self,path):self.path=path
    def connect(self):
        db=sqlite3.connect(self.path);db.row_factory=sqlite3.Row;db.execute('PRAGMA foreign_keys=ON');return db
    def migrate(self):
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS stores (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL COLLATE NOCASE UNIQUE, active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1)')
            columns={r['name'] for r in db.execute('PRAGMA table_info(staff)')}
            if 'store_id' not in columns:db.execute('ALTER TABLE staff ADD COLUMN store_id INTEGER REFERENCES stores(id) ON DELETE RESTRICT')
            db.execute('CREATE TABLE IF NOT EXISTS staff_sales_stores (staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE, month TEXT NOT NULL, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT, PRIMARY KEY(staff_id,month))')
            for row in db.execute('SELECT id,data FROM staff WHERE store_id IS NULL').fetchall():
                data=json.loads(row['data']);name=(data.get('store') or '').strip() or '未設定'
                db.execute('INSERT OR IGNORE INTO stores(name) VALUES (?)',(name,))
                id=db.execute('SELECT id FROM stores WHERE name=?',(name,)).fetchone()['id']
                db.execute('UPDATE staff SET store_id=? WHERE id=?',(id,row['id']))
            for row in db.execute('SELECT id,data,store_id FROM staff').fetchall():self.capture(db,row['id'],json.loads(row['data']),row['store_id'])
    @staticmethod
    def capture(db,id,data,store_id):
        for sale in data.get('sales',[]):db.execute('INSERT OR IGNORE INTO staff_sales_stores VALUES (?,?,?)',(id,sale['month'],store_id))
    @staticmethod
    def row(db,row):
        return dict(json.loads(row['data']),id=row['id'],version=row['version'],store_id=row['store_id'],sales_stores={r['month']:r['store_id'] for r in db.execute('SELECT month,store_id FROM staff_sales_stores WHERE staff_id=?',(row['id'],))})
    def list(self):
        with self.connect() as db:return [self.row(db,r) for r in db.execute('SELECT * FROM staff ORDER BY id').fetchall()]
    @staticmethod
    def affiliation(db,data,old=None):
        id=data.get('store_id')
        if id is None:
            row=db.execute('SELECT id FROM stores WHERE name=?',((data.get('store') or '').strip(),)).fetchone()
            id=row['id'] if row else None
        row=db.execute('SELECT active FROM stores WHERE id=?',(id,)).fetchone()
        if not row or (not row['active'] and (old is None or id!=old['store_id'])):raise StoreError(400,'有効な所属店舗を選択してください。')
        return id
    @staticmethod
    def clean(data):return {k:v for k,v in data.items() if k not in ('id','version','store_id','sales_stores')}
    def create(self,data):
        with self.connect() as db:
            store_id=self.affiliation(db,data);clean=self.clean(data)
            id=db.execute('INSERT INTO staff(data,store_id) VALUES (?,?)',(json.dumps(clean,ensure_ascii=False),store_id)).lastrowid
            self.capture(db,id,clean,store_id)
            return self.row(db,db.execute('SELECT * FROM staff WHERE id=?',(id,)).fetchone())
    def update(self,id,version,data):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            old=db.execute('SELECT * FROM staff WHERE id=?',(id,)).fetchone()
            if not old:raise StoreError(404,'スタッフが見つかりません。')
            if old['version']!=version:raise StoreError(409,'別の画面で更新されています。再読み込みしてください。')
            store_id=self.affiliation(db,data,old);clean=self.clean(data)
            db.execute('UPDATE staff SET data=?,store_id=?,version=version+1 WHERE id=? AND version=?',(json.dumps(clean,ensure_ascii=False),store_id,id,version))
            self.capture(db,id,clean,store_id)
            return self.row(db,db.execute('SELECT * FROM staff WHERE id=?',(id,)).fetchone())
    def delete(self,id,version):
        with self.connect() as db:
            row=db.execute('SELECT version FROM staff WHERE id=?',(id,)).fetchone()
            if not row:raise StoreError(404,'スタッフが見つかりません。')
            if not db.execute('DELETE FROM staff WHERE id=? AND version=?',(id,version)).rowcount:raise StoreError(409,'別の画面で更新されています。')
            return {'ok':True}
    @staticmethod
    def store_row(row):return dict(id=row['id'],name=row['name'],active=bool(row['active']),version=row['version'])
    def list_stores(self):
        with self.connect() as db:return [self.store_row(r) for r in db.execute('SELECT * FROM stores ORDER BY id')]
    def create_store(self,data):
        try:
            with self.connect() as db:
                id=db.execute('INSERT INTO stores(name,active) VALUES (?,?)',(data['name'],data['active'])).lastrowid
                return self.store_row(db.execute('SELECT * FROM stores WHERE id=?',(id,)).fetchone())
        except sqlite3.IntegrityError:raise StoreError(409,'同じ店舗名が存在します。') from None
    def update_store(self,id,version,data):
        try:
            with self.connect() as db:
                if not db.execute('UPDATE stores SET name=?,active=?,version=version+1 WHERE id=? AND version=?',(data['name'],data['active'],id,version)).rowcount:raise StoreError(409,'店舗が別の画面で更新されています。再読み込みしてください。')
                return self.store_row(db.execute('SELECT * FROM stores WHERE id=?',(id,)).fetchone())
        except sqlite3.IntegrityError:raise StoreError(409,'同じ店舗名が存在します。') from None
