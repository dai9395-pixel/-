"""Vercel Python Function: Supabase Auth and RLS + persistent Postgres."""
import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import urlsplit,parse_qs
from lib.cloud_store import CloudStore,Supabase,StoreError
from server import validate,validate_store

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
            query=parse_qs(urlsplit(self.path).query)
            path=urlsplit(self.path).path
            action=query.get('auth_action',[None])[0]
            if path.startswith('/api/auth/'):action=path.removeprefix('/api/auth/')
            token=self.headers.get('Authorization','')
            token=token[7:] if token.startswith('Bearer ') else ''
            if action:
                if method!='POST' or action not in ('login','refresh','logout'):raise StoreError(405,'許可されていない操作です。')
                length=int(self.headers.get('Content-Length','0'))
                if not 0 < length <= 10000:raise StoreError(400,'ログイン情報を確認してください。')
                data=json.loads(self.rfile.read(length))
                if not isinstance(data,dict):raise ValueError()
                auth=Supabase()
                if action=='logout':
                    if not token:raise StoreError(401,'ログインが必要です。')
                    auth.request('/auth/v1/logout?scope=local','POST',{},token)
                    return self.reply(200,{'ok':True})
                result=auth.login(data) if action=='login' else auth.refresh(data)
                return self.reply(200,result)
            if not token:raise StoreError(401,'ログインが必要です。')
            resource=query.get('resource',['staff'])[0]
            if path=='/api/stores' or path.startswith('/api/stores/'):resource='stores'
            if resource not in ('staff','stores'):raise StoreError(404,'見つかりません。')
            raw_id=query.get('store_id' if resource=='stores' else 'staff_id',[None])[0]
            if path.startswith('/api/staff/') and raw_id is None:raw_id=path.removeprefix('/api/staff/')
            if path.startswith('/api/stores/') and raw_id is None:raw_id=path.removeprefix('/api/stores/')
            id=int(raw_id) if raw_id is not None else None
            store=CloudStore(token)
            if method=='GET' and id is None:return self.reply(200,store.list_stores() if resource=='stores' else store.list())
            if resource=='stores' and method=='DELETE':raise StoreError(405,'店舗は削除できません。無効化してください。')
            length=int(self.headers.get('Content-Length','0'))
            if not 0 < length <= 1000000:raise StoreError(413,'送信データのサイズを確認してください。')
            data=json.loads(self.rfile.read(length))
            if not isinstance(data,dict):raise ValueError()
            if resource=='stores':
                if method=='POST' and id is None:return self.reply(201,store.create_store(validate_store(data)))
                version=data.get('version')
                if method=='PUT' and id is not None and id>0 and type(version) is int and version>0:
                    return self.reply(200,store.update_store(id,version,validate_store(data)))
                raise StoreError(400,'店舗の入力内容を確認してください。')
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
