"""Cloud API contract checks. No real cloud keys or services are used."""
import io
import json
import os
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
from unittest.mock import patch
from api.index import handler
from lib.cloud_store import CloudStore,Supabase,StoreError

PASSWORD='fictional-user-access-token'
ENV={'VITE_SUPABASE_URL':'https://example.supabase.co','VITE_SUPABASE_ANON_KEY':'test-only-key'}
DATA={'name':'架空スタッフ','store':'架空店舗','role':'スタイリスト','sales':[],'skills':[],'interviews':[],'progress':0}
class Response(io.BytesIO):
    def __init__(self,value):super().__init__(json.dumps(value).encode())
class CloudTest(unittest.TestCase):
    def setUp(self):self.env=patch.dict(os.environ,ENV);self.env.start()
    def tearDown(self):self.env.stop()
    def test_database_contract_and_atomic_conflict(self):
        with patch('lib.cloud_store.urlopen') as upstream:
            upstream.return_value=Response([{'id':1,'version':1,'data':DATA}])
            with patch.object(CloudStore,'__init__',return_value=None):store=CloudStore('access-token')
            store.url='https://example.supabase.co';store.key='test-only-key';store.token='access-token';self.assertEqual(store.list()[0]['name'],'架空スタッフ')
            req=upstream.call_args.args[0]
            self.assertIn('/rest/v1/staff?',req.full_url);self.assertEqual(req.get_header('Authorization'),'Bearer access-token')
            upstream.side_effect=[Response([{'id':2,'version':1,'data':DATA}]),Response([{'id':2,'version':1,'data':DATA,'store_id':3,'staff_sales_stores':[{'month':'2026-10','store_id':3}]}])];created=store.create({**DATA,'store_id':3});self.assertEqual(created['id'],2);self.assertEqual(created['sales_stores'],{'2026-10':3});self.assertEqual(json.loads(upstream.call_args_list[-2].args[0].data)['store_id'],3);upstream.side_effect=None
            upstream.side_effect=[Response([{'id':2,'version':2,'data':DATA}]),Response([{'id':2,'version':2,'data':DATA}])];self.assertEqual(store.update(2,1,DATA)['version'],2);upstream.side_effect=None
            req=upstream.call_args_list[-2].args[0];self.assertIn('version=eq.1',req.full_url);self.assertEqual(req.method,'PATCH')
            upstream.return_value=Response([])
            with self.assertRaises(StoreError) as error:store.update(2,1,DATA)
            self.assertEqual(error.exception.status,409)
            upstream.return_value=Response([{'id':2}]);self.assertEqual(store.delete(2,2),{'ok':True})
    def test_database_outage_does_not_leak_details(self):
        with patch('lib.cloud_store.urlopen',side_effect=URLError('private connection details test-only-key')):
            with self.assertRaises(StoreError) as error:Supabase().request('/rest/v1/staff')
            self.assertEqual(error.exception.status,502);self.assertNotIn('test-only-key',str(error.exception))
    def test_configuration_is_required(self):
        with patch.dict(os.environ,{'VITE_SUPABASE_URL':'','SUPABASE_URL':''}):
            with self.assertRaises(StoreError):Supabase()
    def test_verified_user_and_database_admin_permission(self):
        with patch('lib.cloud_store.urlopen',side_effect=[Response({'id':'user-1'}),Response(True)]) as upstream:
            store=CloudStore('verified-access-token')
            self.assertEqual(store.token,'verified-access-token')
            self.assertTrue(upstream.call_args_list[0].args[0].full_url.endswith('/auth/v1/user'))
            self.assertTrue(upstream.call_args_list[1].args[0].full_url.endswith('/rest/v1/rpc/is_karte_admin'))
        with patch('lib.cloud_store.urlopen',side_effect=[Response({'id':'user-2'}),Response(False)]):
            with self.assertRaises(StoreError) as denied:CloudStore('unapproved-user-token')
            self.assertEqual(denied.exception.status,403)
        with patch('lib.cloud_store.urlopen',side_effect=HTTPError('https://example.supabase.co',401,'Unauthorized',{},None)):
            with self.assertRaises(StoreError) as denied:CloudStore('forged-token')
            self.assertEqual(denied.exception.status,401)
    def test_login_refresh_and_secret_key_rejection(self):
        result={'access_token':'access','refresh_token':'refresh','expires_in':3600,'user':{'private':'not-returned'}}
        with patch('lib.cloud_store.urlopen',return_value=Response(result)) as upstream:
            session=Supabase().login({'email':'admin@example.test','password':'fictional-test'})
            self.assertNotIn('user',session)
            self.assertEqual(json.loads(upstream.call_args.args[0].data)['email'],'admin@example.test')
        with patch('lib.cloud_store.urlopen',return_value=Response(result)) as upstream:
            Supabase().refresh({'refresh_token':'refresh'})
            self.assertIn('grant_type=refresh_token',upstream.call_args.args[0].full_url)
        with patch.dict(os.environ,{'VITE_SUPABASE_ANON_KEY':'sb_secret_test-only'}):
            with self.assertRaises(StoreError):Supabase()

    def test_http_auth_crud_and_validation(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def request(method='GET',data=None,password=PASSWORD,path='/api/index'):
            req=Request(f'http://127.0.0.1:{server.server_port}'+path,method=method,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer '+password,'Content-Type':'application/json'})
            try:
                with urlopen(req) as response:return response.status,json.load(response)
            except HTTPError as error:return error.code,json.load(error)
        try:
            with patch('api.index.Supabase') as auth:
                auth.return_value.login.return_value={'access_token':'access','refresh_token':'refresh','expires_in':3600}
                status,result=request('POST',{'email':'admin@example.test','password':'fictional-test'},password='',path='/api/index?auth_action=login')
                self.assertEqual(status,200);self.assertEqual(result['access_token'],'access')
                auth.return_value.refresh.return_value={'access_token':'new','refresh_token':'refresh2','expires_in':3600}
                self.assertEqual(request('POST',{'refresh_token':'refresh'},password='',path='/api/index?auth_action=refresh')[1]['access_token'],'new')
                self.assertEqual(request('POST',{},path='/api/index?auth_action=logout')[0],200)
            with patch('api.index.CloudStore') as store:
                self.assertEqual(request(password='')[0],401);store.assert_not_called()
                store.return_value.list.return_value=[{**DATA,'id':1,'version':1}]
                status,rows=request();self.assertEqual(status,200);self.assertNotIn('test-only-key',json.dumps(rows))
                store.return_value.create.return_value={**DATA,'id':2,'version':1}
                self.assertEqual(request('POST',DATA)[0],201)
                invalid={**DATA,'progress':101};self.assertEqual(request('POST',invalid)[0],400)
                store.return_value.update.return_value={**DATA,'id':2,'version':2}
                self.assertEqual(request('PUT',{**DATA,'version':1},path='/api/index?staff_id=2')[0],200)
                store.return_value.delete.return_value={'ok':True}
                self.assertEqual(request('DELETE',{'version':2},path='/api/index?staff_id=2')[0],200)
                self.assertEqual(request('DELETE',{},path='/api/index?staff_id=2')[0],400)
                store.return_value.list_stores.return_value=[{'id':1,'name':'表参道店','active':True,'version':1}]
                self.assertEqual(request(path='/api/index?resource=stores')[1][0]['name'],'表参道店')
                store.return_value.create_store.return_value={'id':2,'name':'新店舗','active':True,'version':1}
                self.assertEqual(request('POST',{'name':'新店舗','active':True},path='/api/stores')[0],201)
                self.assertEqual(request('POST',{'name':'   ','active':True},path='/api/stores')[0],400)
                store.return_value.update_store.return_value={'id':2,'name':'新店舗','active':False,'version':2}
                self.assertFalse(request('PUT',{'name':'新店舗','active':False,'version':1},path='/api/index?resource=stores&store_id=2')[1]['active'])
                self.assertEqual(request('DELETE',{'version':2},path='/api/stores/2')[0],405)
                self.assertEqual(request(path='/api/stores',password='')[0],401)
                store.side_effect=StoreError(403,'管理者未登録');self.assertEqual(request()[0],403);self.assertEqual(request(path='/api/stores')[0],403)
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
