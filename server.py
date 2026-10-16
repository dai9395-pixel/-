"""スタッフ成長カルテ: Python standard library + SQLite."""
import argparse
import json
import sqlite3
import os
import math
from datetime import date
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent
DB = Path(os.environ.get('KARTE_DB', str(ROOT / 'data' / 'karte.sqlite3')))
SKILLS = ['ビジネススキル', 'マナースキル', 'テクニカルスキル', 'サービススキル', 'エンゲージメントスキル', 'マーケティング・顧客理解']

def connection():
    db = sqlite3.connect(DB)
    db.execute('PRAGMA foreign_keys=ON')
    return db

def initialize():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with connection() as db:
        db.execute('CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1)')
        db.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)')
        if not db.execute("SELECT 1 FROM metadata WHERE key='seeded'").fetchone():
            names = ['青山 はるか','橘 蓮','白石 みお','藤井 そら','水野 あおい','森 ひなた','小林 なぎ','高橋 りつ','中村 つむぎ','佐藤 いおり','山本 ゆう','石田 かえで','井上 さく','松本 りお','吉田 こと']
            today = date.today()
            for i, name in enumerate(names):
                sales = []
                for back in range(5, -1, -1):
                    ordinal = today.year * 12 + today.month - 1 - back
                    month = f'{ordinal // 12:04}-{ordinal % 12 + 1:02}'
                    actual = 650000 + i * 23000 + (5-back) * 42000
                    sales.append(dict(month=month, target=1000000, actual=actual, nominated=round(actual*.72), customers=70+i*2))
                data = dict(name=name, store=['表参道店','代官山店','自由が丘店'][i%3], role=['スタイリスト','トップスタイリスト','アシスタント'][i%3], vision='お客様の毎日に、自信と笑顔を届けられる美容師へ。', annual='指名のお客様を増やし、信頼されるスタイリストになる', monthly='再来店につながるカウンセリングを実践する', challenge='お客様のライフスタイルを深く理解する', action='施術前に悩みを3つ伺い、次回の提案まで伝える', progress=60+i%4*10, sales=sales, skills=[dict(date=today.replace(day=1).isoformat(), scores=[3+i%2,4,3,4,3,2+i%3])], interviews=[dict(date=today.replace(day=1).isoformat(), worry='提案に自信が持てないことがある', challenge='カウンセリングの引き出しを増やす', feedback='丁寧な聞き取りが強み。小さな成功体験を一緒に増やしていきましょう。', next='週に1回、先輩と提案のロールプレイを行う')])
                db.execute('INSERT INTO staff(data) VALUES (?)', (json.dumps(data, ensure_ascii=False),))
            db.execute("INSERT INTO metadata VALUES ('seeded','1')")

def validate(data):
    if not isinstance(data, dict): raise ValueError('データ形式が不正です')
    for key in ['name','store','role']:
        if not isinstance(data.get(key), str) or not data[key].strip(): raise ValueError('名前・店舗・役職を入力してください')
        if len(data[key]) > 100: raise ValueError('入力は100文字以内にしてください')
    for key in ['vision','annual','monthly','challenge','action']:
        if not isinstance(data.get(key,''),str): raise ValueError('目標の形式が不正です')
    def number(value, maximum=1000000000):
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not 0 <= value <= maximum: raise ValueError('数値の入力範囲を確認してください')
    number(data.get('progress',0),100)
    months=set()
    for row in data.get('sales',[]):
        date.fromisoformat(row['month']+'-01')
        if row['month'] in months: raise ValueError('同じ月の売上が重複しています')
        months.add(row['month'])
        for key in ['target','actual','nominated','customers']: number(row[key])
        if int(row['customers']) != row['customers']: raise ValueError('客数は整数にしてください')
        if row['nominated'] > row['actual']: raise ValueError('指名売上は売上実績以下にしてください')
    for row in data.get('skills',[]):
        date.fromisoformat(row['date'])
        if len(row['scores']) != 6: raise ValueError('6分野の評価を入力してください')
        for score in row['scores']:
            number(score,5)
            if score < 1 or int(score)!=score: raise ValueError('評価は1〜5で入力してください')
    for row in data.get('interviews',[]):
        date.fromisoformat(row['date'])
        for key in ['worry','challenge','feedback','next']:
            if not isinstance(row.get(key),str): raise ValueError('面談の入力内容を確認してください')
    return {k:v for k,v in data.items() if k not in ('id','version')}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT/'public'),**kwargs)
    def reply(self,status,data):
        body=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path=='/api/staff':
            with connection() as db:
                rows=[dict(json.loads(data),id=id,version=version) for id,data,version in db.execute('SELECT id,data,version FROM staff ORDER BY id')]
            return self.reply(200,rows)
        if self.path.startswith('/api/'): return self.reply(404,{'error':'見つかりません'})
        return super().do_GET()
    def mutate(self,method):
        try:
            parts=self.path.split('/')
            if parts[:3]!=['','api','staff'] or len(parts) not in (3,4): return self.reply(404,{'error':'見つかりません'})
            length=int(self.headers.get('Content-Length','0'))
            if length>1000000: return self.reply(413,{'error':'データが大きすぎます'})
            data=json.loads(self.rfile.read(length) or b'{}')
            with connection() as db:
                if method=='POST' and len(parts)==3:
                    clean=validate(data)
                    cursor=db.execute('INSERT INTO staff(data) VALUES (?)',(json.dumps(clean,ensure_ascii=False),))
                    result=dict(clean,id=cursor.lastrowid,version=1)
                elif method in ('PUT','DELETE') and len(parts)==4:
                    id=int(parts[3]); row=db.execute('SELECT version FROM staff WHERE id=?',(id,)).fetchone()
                    if not row: return self.reply(404,{'error':'スタッフが見つかりません'})
                    if data.get('version')!=row[0]: return self.reply(409,{'error':'別の画面で更新されています。再読み込みしてください。'})
                    if method=='DELETE':
                        db.execute('DELETE FROM staff WHERE id=?',(id,)); result={'ok':True}
                    else:
                        clean=validate(data)
                        db.execute('UPDATE staff SET data=?,version=version+1 WHERE id=?',(json.dumps(clean,ensure_ascii=False),id))
                        result=dict(clean,id=id,version=row[0]+1)
                else: return self.reply(405,{'error':'許可されていない操作です'})
            self.reply(201 if method=='POST' else 200,result)
        except (ValueError,KeyError,TypeError): self.reply(400,{'error':'入力内容を確認してください。必須項目・数値・日付が不正です。'})
    def do_POST(self): self.mutate('POST')
    def do_PUT(self): self.mutate('PUT')
    def do_DELETE(self): self.mutate('DELETE')

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--host',default='127.0.0.1')
    parser.add_argument('--port',type=int,default=8000)
    parser.add_argument('--cloud',action='store_true',help='Use Supabase Auth / PostgreSQL instead of local SQLite')
    args=parser.parse_args()
    selected_handler=Handler
    if args.cloud:
        from api.index import handler as CloudHandler
        class CloudDevelopmentHandler(CloudHandler, SimpleHTTPRequestHandler):
            def __init__(self,*values,**kwargs):
                SimpleHTTPRequestHandler.__init__(self,*values,directory=str(ROOT/'public'),**kwargs)
            def do_GET(self):
                if self.path=='/runtime.json':return self.reply(200,{'authentication':True})
                if self.path.startswith('/api/'):return CloudHandler.do_GET(self)
                return SimpleHTTPRequestHandler.do_GET(self)
        selected_handler=CloudDevelopmentHandler
    else:
        initialize()
    print(f"スタッフ成長カルテ ({'Supabase' if args.cloud else 'SQLite sample'}) http://{args.host}:{args.port}",flush=True)
    ThreadingHTTPServer((args.host,args.port),selected_handler).serve_forever()
