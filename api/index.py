"""Vercel Python Function: shared administrator password + persistent Postgres."""
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlsplit,parse_qs
from lib.cloud_store import CloudStore,StoreError
from server import validate

class handler(BaseHTTPRequestHandler):
    def reply(self,status,data):
        body=json.dumps(data,ensure_ascii=False,allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers();self.wfile.write(body)
    def run_request(self,method):
        try:
            password=os.environ.get('ADMIN_PASSWORD','')
            if len(password)<16:raise StoreError(503,'管理者パスワードの設定が未完了です。16文字以上で設定してください。')
            token=self.headers.get('Authorization','')
            if not hmac.compare_digest(token.encode(),('Bearer '+password).encode()):raise StoreError(401,'ログインが必要です。パスワードを確認してください。')
            query=parse_qs(urlsplit(self.path).query)
            path=urlsplit(self.path).path
            raw_id=query.get('staff_id',[None])[0]
            if path.startswith('/api/staff/') and raw_id is None:raw_id=path.removeprefix('/api/staff/')
            id=int(raw_id) if raw_id is not None else None
            store=CloudStore()
            if method=='GET' and id is None:return self.reply(200,store.list())
            length=int(self.headers.get('Content-Length','0'))
            if not 0 < length <= 1000000:raise StoreError(413,'送信データのサイズを確認してください。')
            data=json.loads(self.rfile.read(length))
            if not isinstance(data,dict):raise ValueError()
            if method=='POST' and id is None:return self.reply(201,store.create(validate(data)))
            version=data.get('version')
            if type(version) is not int or version<1 or id is None or id<1:raise ValueError()
            if method=='PUT':return self.reply(200,store.update(id,version,validate(data)))
            if method=='DELETE':return self.reply(200,store.delete(id,version))
            raise StoreError(405,'許可されていない操作です。')
        except StoreError as error:self.reply(error.status,{'error':str(error)})
        except (ValueError,KeyError,TypeError,OverflowError):self.reply(400,{'error':'入力内容を確認してください。'})
    def do_GET(self):self.run_request('GET')
    def do_POST(self):self.run_request('POST')
    def do_PUT(self):self.run_request('PUT')
    def do_DELETE(self):self.run_request('DELETE')
