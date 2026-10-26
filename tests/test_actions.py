import unittest
from server import validate

class ActionValidationTest(unittest.TestCase):
    def record(self, **changes):
        row=dict(date='2026-10-26',worry='',challenge='',feedback='',next='提案の練習')
        row.update(changes)
        return dict(name='テスト',store='店舗',role='スタッフ',interviews=[row])
    def test_legacy_and_valid_actions(self):
        for changes in [{},dict(due='',status='todo'),dict(due='2026-11-01',status='doing'),dict(due='2026-11-01',status='done')]:
            data=self.record(**changes)
            self.assertEqual(validate(data),data)
    def test_invalid_actions(self):
        for changes in [dict(due='2026-02-30'),dict(due=12),dict(status='unknown'),dict(due='2026-11-01',next=' '),dict(status='done',next='')]:
            with self.subTest(changes=changes),self.assertRaises(ValueError):validate(self.record(**changes))
