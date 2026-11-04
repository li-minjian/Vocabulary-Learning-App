"""Real PostgreSQL adapter for isolated tests, never imported by production."""
import json
import os
from urllib.parse import urlsplit
from types import SimpleNamespace
import psycopg2
from psycopg2.extras import RealDictCursor, Json
from psycopg2 import sql
DSN = os.environ.get('VOCA_EXERCISE_TEST_DSN', 'postgresql://postgres:exercise-fixture-local@127.0.0.1:54398/voca_exercises')
_target=urlsplit(DSN)
if _target.hostname not in ('127.0.0.1','localhost') or not _target.path.startswith('/voca_'):
    raise RuntimeError('Exercise test adapter only permits named disposable local databases.')
USER = '11111111-1111-1111-1111-111111111111'
OTHER = '22222222-2222-2222-2222-222222222222'

def serial(row):
    return json.loads(json.dumps(dict(row), default=lambda x: x.isoformat() if hasattr(x, 'isoformat') else str(x)))

class Query:

    def __init__(self, db, table):
        self.db = db
        self.table = table
        self.filters = []
        self.orders = []
        self.bounds = None
        self.op = 'select'
        self.fields = '*'

    def select(self, fields='*'):
        self.fields = fields
        return self

    def eq(self, key, value):
        self.filters.append((key, '=', value))
        return self

    def is_(self, key, value):
        if value != 'null': raise ValueError('Only null fixture filter supported')
        self.filters.append((key, 'IS', None))
        return self

    def single(self):
        self.as_single = True
        return self

    def lte(self, key, value):
        self.filters.append((key, '<=', value))
        return self

    def in_(self, key, value):
        self.filters.append((key, 'IN', tuple(value)))
        return self

    def order(self, key, **kwargs):
        self.orders.append((key, kwargs.get('desc', False)))
        return self

    def range(self, start, end):
        self.bounds = (start, end - start + 1)
        return self

    def limit(self, n):
        self.bounds = (0, n)
        return self

    def insert(self, data):
        self.op = 'insert'
        self.values = data
        return self

    def upsert(self, data, **kwargs):
        self.op = 'upsert'
        self.values = data
        self.conflict = kwargs.get('on_conflict', 'id')
        self.ignore = kwargs.get('ignore_duplicates', False)
        return self

    def update(self, data):
        self.op = 'update'
        self.values = data
        return self

    def delete(self):
        self.op = 'delete'
        return self

    def execute(self):
        with self.db.conn.cursor(cursor_factory=RealDictCursor) as cur:
            try:
                values = []
                if self.op in ('insert', 'upsert'):
                    result = []
                    for row in self.values if isinstance(self.values, list) else [self.values]:
                        keys = list(row)
                        query = sql.SQL('INSERT INTO {} ({}) VALUES ({})').format(sql.Identifier(self.table), sql.SQL(',').join(map(sql.Identifier, keys)), sql.SQL(',').join((sql.Placeholder() for _ in keys)))
                        if self.op == 'upsert':
                            query += sql.SQL(' ON CONFLICT ({}) DO NOTHING').format(sql.SQL(',').join((sql.Identifier(k) for k in self.conflict.split(',')))) if self.ignore else sql.SQL(' ON CONFLICT ({}) DO UPDATE SET {}').format(sql.SQL(',').join((sql.Identifier(k) for k in self.conflict.split(','))), sql.SQL(',').join((sql.SQL('{}=excluded.{}').format(sql.Identifier(k), sql.Identifier(k)) for k in keys)))
                        query += sql.SQL(' RETURNING *')
                        cur.execute(query, [Json(row[k]) if isinstance(row[k], (dict, list)) else row[k] for k in keys])
                        result.extend(map(serial, cur.fetchall()))
                    self.db.conn.commit()
                    return SimpleNamespace(data=result)
                fields = sql.SQL('*') if '*' in self.fields or '(' in self.fields else sql.SQL(',').join((sql.Identifier(k.strip()) for k in self.fields.split(',')))
                if self.op == 'select':
                    query = sql.SQL('SELECT {} FROM {}').format(fields, sql.Identifier(self.table))
                elif self.op == 'delete':
                    query = sql.SQL('DELETE FROM {}').format(sql.Identifier(self.table))
                else:
                    query = sql.SQL('UPDATE {} SET {}').format(sql.Identifier(self.table), sql.SQL(',').join((sql.SQL('{}=%s').format(sql.Identifier(k)) for k in self.values)))
                    values.extend((Json(v) if isinstance(v, (dict, list)) else v for v in self.values.values()))
                if self.filters:
                    query += sql.SQL(' WHERE ') + sql.SQL(' AND ').join((sql.SQL('{} IS NULL').format(sql.Identifier(k)) if op=='IS' else sql.SQL('{} {} %s').format(sql.Identifier(k), sql.SQL(op)) for k, op, _ in self.filters))
                    values.extend((v for _, op, v in self.filters if op!='IS'))
                if self.op == 'select':
                    if self.orders:
                        query += sql.SQL(' ORDER BY ') + sql.SQL(',').join((sql.SQL('{} {}').format(sql.Identifier(k), sql.SQL('DESC' if desc else 'ASC')) for k, desc in self.orders))
                    if self.bounds:
                        query += sql.SQL(' OFFSET %s LIMIT %s')
                        values.extend(self.bounds)
                else:
                    query += sql.SQL(' RETURNING *')
                cur.execute(query, values)
                result = list(map(serial, cur.fetchall()))
                if self.op=='select' and self.table=='words' and '(' in self.fields:
                    for word in result:
                        for table in ('examples','collocations','synonyms'):
                            cur.execute(sql.SQL('select * from {} where word_id=%s and user_id=auth.uid()').format(sql.Identifier(table)),[word['id']])
                            word[table]=list(map(serial,cur.fetchall()))
                        word['tags']=[]
                        if 'vocabulary_attempts(count)' in self.fields:
                            cur.execute('select count(*) from vocabulary_attempts where word_id=%s and user_id=auth.uid()',[word['id']])
                            word['vocabulary_attempts']=[{'count':cur.fetchone()['count']}]
                if self.op=='select' and self.table=='collections' and 'words(count)' in self.fields:
                    for collection in result:
                        cur.execute('select count(*) from words where collection_id=%s and user_id=auth.uid()',[collection['id']])
                        collection['words']=[{'count':cur.fetchone()['count']}]
                self.db.conn.commit()
                return SimpleNamespace(data=result[0] if result and getattr(self,'as_single',False) else result)
            except Exception:
                self.db.conn.rollback()
                raise

class Database:

    def __init__(self, user=USER):
        self.conn = psycopg2.connect(DSN)
        with self.conn.cursor() as c:
            c.execute('SET ROLE authenticated')
            c.execute("select set_config('request.jwt.claim.sub',%s,false)", [user])
        self.conn.commit()

    def table(self, name):
        return Query(self, name)

    def rpc(self, name, params):
        db = self

        class Call:

            def execute(self):
                with db.conn.cursor() as c:
                    try:
                        c.execute(sql.SQL('select public.{}({})').format(sql.Identifier(name), sql.SQL(',').join((sql.SQL('{} => %s').format(sql.Identifier(k)) for k in params))), [Json(v) if isinstance(v, (dict, list)) else v for v in params.values()])
                        result = c.fetchone()[0]
                        db.conn.commit()
                        return SimpleNamespace(data=result)
                    except Exception:
                        db.conn.rollback()
                        raise
        return Call()
