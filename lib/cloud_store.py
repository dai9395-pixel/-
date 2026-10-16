"""Supabase Auth + REST adapter using the caller's JWT; RLS is always enforced."""
import json
import os
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

class StoreError(Exception):
    def __init__(self,status,message): self.status=status;super().__init__(message)

class Supabase:
    def __init__(self):
        self.url=(os.environ.get('VITE_SUPABASE_URL') or os.environ.get('SUPABASE_URL','')).rstrip('/')
        self.key=os.environ.get('VITE_SUPABASE_ANON_KEY') or os.environ.get('SUPABASE_ANON_KEY','')
        parsed=urlsplit(self.url)
        if parsed.scheme!='https' or not parsed.hostname or parsed.path not in ('','/') or parsed.query or parsed.fragment or not self.key:
            raise StoreError(503,'Supabase設定が未完了です。VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEYを設定して再デプロイしてください。')
        # A legacy JWT service-role key must never be accepted as an anon key.
        if self.key.startswith('sb_secret_'):raise StoreError(503,'公開キーに秘密キーは使用できません。anonキーを設定してください。')
        try:
            import base64
            payload=json.loads(base64.urlsafe_b64decode(self.key.split('.')[1]+'==='))
            if payload.get('role')=='service_role':raise StoreError(503,'anonキーの設定にservice_roleキーは使用できません。')
        except (IndexError,ValueError,TypeError):pass
    def request(self,path,method='GET',data=None,token=None):
        headers={'apikey':self.key,'Content-Type':'application/json','Prefer':'return=representation'}
        if token:headers['Authorization']='Bearer '+token
        req=Request(self.url+path,method=method,
            headers=headers,
            data=None if data is None else json.dumps(data,ensure_ascii=False,allow_nan=False).encode())
        try:
            with urlopen(req,timeout=15) as response:
                body=response.read();return json.loads(body) if body else None
        except HTTPError as error:
            if error.code==401:raise StoreError(401,'ログインの有効期限が切れました。再度ログインしてください。') from None
            if error.code==403:raise StoreError(403,'この操作のアクセス権限がありません。') from None
            if path.startswith('/auth/') and error.code in (400,422):raise StoreError(401,'メールアドレス・パスワード、またはログインの有効期限を確認してください。') from None
            if error.code==429:raise StoreError(429,'操作が多すぎます。少し待ってからお試しください。') from None
            raise StoreError(502,'Supabaseに接続できませんでした。SQLの実行・接続設定・稼働状況を確認してください。') from None
        except (URLError,TimeoutError,ValueError):
            raise StoreError(502,'Supabaseに接続できませんでした。設定と稼働状況を確認してください。') from None
    def login(self,data):
        if not isinstance(data.get('email'),str) or not isinstance(data.get('password'),str):raise StoreError(400,'メールアドレスとパスワードを入力してください。')
        return self.session(self.request('/auth/v1/token?grant_type=password','POST',{'email':data['email'],'password':data['password']}))
    def refresh(self,data):
        if not isinstance(data.get('refresh_token'),str):raise StoreError(400,'再ログインしてください。')
        return self.session(self.request('/auth/v1/token?grant_type=refresh_token','POST',{'refresh_token':data['refresh_token']}))
    @staticmethod
    def session(data):return {k:data[k] for k in ('access_token','refresh_token','expires_in')}

class CloudStore(Supabase):
    def __init__(self,token):
        super().__init__()
        if not token:raise StoreError(401,'ログインが必要です。')
        self.token=token
        # Validate with Auth; never trust a decoded JWT alone.
        self.request('/auth/v1/user',token=token)
        if self.request('/rest/v1/rpc/is_karte_admin','POST',{},token=token) is not True:
            raise StoreError(403,'このアカウントは管理者として登録されていません。管理者設定を確認してください。')
    def rest(self,method,query,data=None):return self.request('/rest/v1/staff?'+urlencode(query),method,data,self.token)
    @staticmethod
    def row(row):return {**row['data'],'id':row['id'],'version':row['version']}
    def list(self):return [self.row(row) for row in self.rest('GET',{'select':'id,data,version','order':'id.asc'})]
    def create(self,data):return self.row(self.rest('POST',{'select':'id,data,version'},{'data':data})[0])
    def update(self,id,version,data):
        rows=self.rest('PATCH',{'id':f'eq.{id}','version':f'eq.{version}','select':'id,data,version'},{'data':data,'version':version+1})
        if not rows:raise StoreError(409,'更新の競合または削除がありました。再読み込みしてください。')
        return self.row(rows[0])
    def delete(self,id,version):
        rows=self.rest('DELETE',{'id':f'eq.{id}','version':f'eq.{version}','select':'id'})
        if not rows:raise StoreError(409,'更新の競合または削除がありました。再読み込みしてください。')
        return {'ok':True}
