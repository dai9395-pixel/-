"""Server-only Supabase REST adapter. Never expose the service role key to clients."""
import json
import os
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

class StoreError(Exception):
    def __init__(self,status,message): self.status=status;super().__init__(message)

class CloudStore:
    def __init__(self):
        self.url=os.environ.get('SUPABASE_URL','').rstrip('/')
        self.key=os.environ.get('SUPABASE_SERVICE_ROLE_KEY','')
        parsed=urlsplit(self.url)
        if parsed.scheme!='https' or not parsed.hostname or parsed.path not in ('','/') or parsed.query or parsed.fragment or not self.key:
            raise StoreError(503,'データベース設定が未完了です。Vercelの環境変数を確認してください。')
    def request(self,method,query,data=None):
        req=Request(self.url+'/rest/v1/staff?'+urlencode(query),method=method,
            headers={'apikey':self.key,'Authorization':'Bearer '+self.key,'Content-Type':'application/json','Prefer':'return=representation'},
            data=None if data is None else json.dumps(data,ensure_ascii=False,allow_nan=False).encode())
        try:
            with urlopen(req,timeout=15) as response:return json.load(response)
        except (HTTPError,URLError,TimeoutError,ValueError):
            raise StoreError(502,'データベースに接続できませんでした。設定と稼働状況を確認してください。') from None
    @staticmethod
    def row(row):return {**row['data'],'id':row['id'],'version':row['version']}
    def list(self):return [self.row(row) for row in self.request('GET',{'select':'id,data,version','order':'id.asc'})]
    def create(self,data):return self.row(self.request('POST',{'select':'id,data,version'},{'data':data})[0])
    def update(self,id,version,data):
        rows=self.request('PATCH',{'id':f'eq.{id}','version':f'eq.{version}','select':'id,data,version'},{'data':data,'version':version+1})
        if not rows:raise StoreError(409,'更新の競合または削除がありました。再読み込みしてください。')
        return self.row(rows[0])
    def delete(self,id,version):
        rows=self.request('DELETE',{'id':f'eq.{id}','version':f'eq.{version}','select':'id'})
        if not rows:raise StoreError(409,'更新の競合または削除がありました。再読み込みしてください。')
        return {'ok':True}
