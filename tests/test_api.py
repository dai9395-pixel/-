import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import urllib.error
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        cls.environment={**os.environ,'KARTE_DB':str(Path(cls.tmp.name)/'test.sqlite3')}
        cls.start()
    @classmethod
    def start(cls):
        cls.process=subprocess.Popen([sys.executable,str(ROOT/'server.py'),'--port','18081'],env=cls.environment,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        for _ in range(100):
            try: cls.request();return
            except Exception: time.sleep(.05)
        raise RuntimeError('server did not start')
    @classmethod
    def request(cls,path='/api/staff',method='GET',data=None):
        req=urllib.request.Request('http://127.0.0.1:18081'+path,data=None if data is None else json.dumps(data).encode(),method=method,headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req) as response:return json.load(response)
    @classmethod
    def tearDownClass(cls):
        cls.process.terminate();cls.process.wait();cls.tmp.cleanup()
    def test_crud_validation_conflicts_and_restart(self):
        sample=self.request();self.assertEqual(len(sample),15)
        row={**sample[0],'name':'検証用 架空スタッフ','sales':[],'skills':[],'interviews':[]}
        row=self.request(method='POST',data=row);path=f"/api/staff/{row['id']}"
        row['sales']=[dict(month='2026-10',target=1000000,actual=900000,nominated=500000,customers=90)]
        row['skills']=[dict(date='2026-10-16',scores=[1,2,3,4,5,3])]
        row['interviews']=[dict(date='2026-10-16',worry='悩み',challenge='課題',feedback='対話',next='行動')]
        stale=dict(row)
        row=self.request(path,'PUT',row)
        with self.assertRaises(urllib.error.HTTPError) as conflict:self.request(path,'PUT',stale)
        self.assertEqual(conflict.exception.code,409)
        invalid={**row,'sales':[dict(month='2026-10',target=100,actual=-1,nominated=0,customers=1)]}
        with self.assertRaises(urllib.error.HTTPError) as bad:self.request(path,'PUT',invalid)
        self.assertEqual(bad.exception.code,400)
        self.process.terminate();self.process.wait();self.start()
        restored=next(x for x in self.request() if x['id']==row['id'])
        self.assertEqual(restored,row)
        self.request(path,'DELETE',{'version':row['version']})
        self.assertEqual(len(self.request()),15)
        with self.assertRaises(urllib.error.HTTPError) as missing:self.request(path,'DELETE',{'version':row['version']})
        self.assertEqual(missing.exception.code,404)

if __name__=='__main__':unittest.main()
