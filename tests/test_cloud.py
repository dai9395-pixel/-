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
from lib.cloud_store import CloudStore,StoreError

PASSWORD='a-fictional-test-password-only'
ENV={'ADMIN_PASSWORD':PASSWORD,'SUPABASE_URL':'https://example.supabase.co','SUPABASE_SERVICE_ROLE_KEY':'test-only-key'}
DATA={'name':'架空スタッフ','store':'架空店舗','role':'スタイリスト','sales':[],'skills':[],'interviews':[],'progress':0}
class Response(io.BytesIO):
    def __init__(self,value):super().__init__(json.dumps(value).encode())
class CloudTest(unittest.TestCase):
    def setUp(self):self.env=patch.dict(os.environ,ENV);self.env.start()
    def tearDown(self):self.env.stop()
    def test_database_contract_and_atomic_conflict(self):
        with patch('lib.cloud_store.urlopen') as upstream:
            upstream.return_value=Response([{'id':1,'version':1,'data':DATA}])
            store=CloudStore();self.assertEqual(store.list()[0]['name'],'架空スタッフ')
            req=upstream.call_args.args[0]
            self.assertIn('/rest/v1/staff?',req.full_url);self.assertEqual(req.get_header('Authorization'),'Bearer test-only-key')
            upstream.return_value=Response([{'id':2,'version':1,'data':DATA}]);self.assertEqual(store.create(DATA)['id'],2)
            upstream.return_value=Response([{'id':2,'version':2,'data':DATA}]);self.assertEqual(store.update(2,1,DATA)['version'],2)
            req=upstream.call_args.args[0];self.assertIn('version=eq.1',req.full_url);self.assertEqual(req.method,'PATCH')
            upstream.return_value=Response([])
            with self.assertRaises(StoreError) as error:store.update(2,1,DATA)
            self.assertEqual(error.exception.status,409)
            upstream.return_value=Response([{'id':2}]);self.assertEqual(store.delete(2,2),{'ok':True})
    def test_database_outage_does_not_leak_details(self):
        with patch('lib.cloud_store.urlopen',side_effect=URLError('private connection details test-only-key')):
            with self.assertRaises(StoreError) as error:CloudStore().list()
            self.assertEqual(error.exception.status,502);self.assertNotIn('test-only-key',str(error.exception))
    def test_configuration_is_required(self):
        with patch.dict(os.environ,{'SUPABASE_URL':''}):
            with self.assertRaises(StoreError):CloudStore()
    def test_http_auth_crud_and_validation(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        def request(method='GET',data=None,password=PASSWORD,path='/api/index'):
            req=Request(f'http://127.0.0.1:{server.server_port}'+path,method=method,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer '+password,'Content-Type':'application/json'})
            try:
                with urlopen(req) as response:return response.status,json.load(response)
            except HTTPError as error:return error.code,json.load(error)
        try:
            with patch('api.index.CloudStore') as store:
                self.assertEqual(request(password='wrong')[0],401);store.assert_not_called()
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
                with patch.dict(os.environ,{'ADMIN_PASSWORD':''}):self.assertEqual(request()[0],503)
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
