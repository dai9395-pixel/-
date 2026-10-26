import json, threading, unittest
from http.server import ThreadingHTTPServer
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from unittest.mock import patch
from api.index import handler,COOKIE
from lib.cloud_store import StoreError

class PersistentAuthTest(unittest.TestCase):
 def setUp(self):
  self.server=ThreadingHTTPServer(('127.0.0.1',0),handler)
  self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
  self.mock=patch('api.index.Supabase');self.auth=self.mock.start().return_value
  self.auth.login.return_value={'access_token':'test-access','refresh_token':'test-refresh','expires_in':3600}
  self.auth.refresh.return_value={'access_token':'test-new','refresh_token':'test-rotated','expires_in':3600}
 def tearDown(self):self.mock.stop();self.server.shutdown();self.server.server_close();self.thread.join()
 def request(self,action,data=None,headers=None):
  req=Request(f'http://127.0.0.1:{self.server.server_port}/api/auth/{action}',data=json.dumps(data or {}).encode(),headers={'Content-Type':'application/json',**(headers or {})})
  try:r=urlopen(req)
  except HTTPError as e:r=e
  with r:return r.status,json.load(r),r.headers
 def test_persistent_restore_rotation_and_logout(self):
  status,body,headers=self.request('login',{'remember':True})
  self.assertEqual(status,200);self.assertNotIn('refresh_token',body)
  cookie=headers['Set-Cookie']
  for flag in ['HttpOnly','Secure','SameSite=Strict','Max-Age=2592000','Path=/']:self.assertIn(flag,cookie)
  status,body,headers=self.request('refresh',headers={'Cookie':f'{COOKIE}=test-refresh'})
  self.assertEqual(body['access_token'],'test-new');self.assertNotIn('refresh_token',body)
  self.auth.refresh.assert_called_once_with({'refresh_token':'test-refresh'})
  self.assertIn('test-rotated',headers['Set-Cookie'])
  status,_,headers=self.request('logout',headers={'Authorization':'Bearer test-new'})
  self.assertEqual(status,200);self.assertIn('Max-Age=0',headers['Set-Cookie'])
 def test_opt_out_and_absent_cookie(self):
  _,body,headers=self.request('login',{'remember':False})
  self.assertIn('refresh_token',body);self.assertIn('Max-Age=0',headers['Set-Cookie'])
  status,_,_=self.request('refresh');self.assertEqual(status,401);self.auth.refresh.assert_not_called()
 def test_cross_site_and_non_json_are_rejected(self):
  for headers in [{'Origin':'https://evil.example'},{'Sec-Fetch-Site':'cross-site'},{'Content-Type':'text/plain'}]:
   status,_,_=self.request('login',{'remember':True},headers)
   self.assertIn(status,[403,415])
  self.auth.login.assert_not_called()
 def test_transient_error_keeps_cookie_invalid_session_clears(self):
  for code,cleared in [(502,False),(401,True)]:
   self.auth.refresh.side_effect=StoreError(code,'test error')
   status,_,headers=self.request('refresh',headers={'Cookie':f'{COOKIE}=test-refresh'})
   self.assertEqual(status,code);self.assertEqual('Set-Cookie' in headers,cleared)
