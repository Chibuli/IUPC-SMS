"""Owned disposable Supabase Auth/PostgREST/PG15 stack, no existing database.
Cached images only, internal Docker network, tmpfs cluster, loopback-only APIs.
No service-role JWT is minted or used. Stop via the printed local stop marker.
"""
from pathlib import Path
import base64, hashlib, hmac, json, secrets, socket, subprocess, time, uuid
from urllib.request import Request, build_opener, ProxyHandler
urlopen=build_opener(ProxyHandler({})).open

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.local-migration/phase2b-review'
NAME='iupc-history-e2e-'+uuid.uuid4().hex[:10]
DB=NAME+'-db';AUTH=NAME+'-auth';REST=NAME+'-rest';KONG=NAME+'-gateway';ACCESS=NAME+'-loopback'
IMAGES={'db':'public.ecr.aws/supabase/postgres:15.19.0.007','auth':'public.ecr.aws/supabase/gotrue:v2.197.0','rest':'public.ecr.aws/supabase/postgrest:v14.18','gateway':'public.ecr.aws/supabase/kong:2.8.1'}
def run(*args,input=None):
    result=subprocess.run(args,input=input,text=True,encoding='utf-8',capture_output=True,timeout=60)
    if result.returncode: raise RuntimeError(result.stderr[-2000:]+result.stdout[-2000:])
    return result.stdout.strip()
def sql(text): return run('docker','exec','-i',DB,'psql','-X','-h','/tmp','-U','postgres','-v','ON_ERROR_STOP=1','-At',input=text)
def port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def http(url,body=None):
    req=Request(url,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
    with urlopen(req,timeout=10) as response:return json.load(response)
def wait_http(url):
    for _ in range(120):
        try:return http(url)
        except Exception:time.sleep(.25)
    raise RuntimeError('Local service did not become ready: '+url)
def main():
    OUT.mkdir(parents=True,exist_ok=True)
    stop=OUT/(NAME+'.stop'); owned=[];network=False
    auth_port,rest_port,gateway_port=port(),port(),port()
    secret=secrets.token_hex(32)
    try:
        run('docker','network','create','--internal','--label','iupc.test=history-final',NAME);network=True
        run('docker','run','-d','--pull','never','--network',NAME,'--user','postgres','--tmpfs','/tmp:rw,mode=1777','--name',DB,'--label','iupc.test=history-final','--entrypoint','sh',IMAGES['db'],'-c',
            'initdb -D /tmp/disposable -U postgres -A trust --no-locale --encoding=UTF8 >/tmp/init.log && echo "host all all 0.0.0.0/0 trust" >> /tmp/disposable/pg_hba.conf && exec postgres -D /tmp/disposable -k /tmp -h 0.0.0.0');owned.append(DB)
        for _ in range(80):
            try:sql('select 1;');break
            except Exception:time.sleep(.25)
        run('docker','network','create','--label','iupc.test=history-final',ACCESS)
        kong_config={'_format_version':'2.1','services':[
          {'name':'auth','url':f'http://{AUTH}:9999','routes':[{'name':'auth','paths':['/auth/v1'],'strip_path':True}]},
          {'name':'rest','url':f'http://{REST}:3000','routes':[{'name':'rest','paths':['/rest/v1'],'strip_path':True}]}],
          'plugins':[{'name':'cors','config':{'origins':['http://127.0.0.1:5178'],'methods':['GET','POST','PATCH','DELETE','HEAD','OPTIONS'],'headers':['authorization','apikey','content-type','x-client-info','prefer','range','x-supabase-api-version','accept-profile','content-profile','x-retry-count'],'exposed_headers':['content-range'],'credentials':True}}]}
        kong_file=OUT/(NAME+'-gateway.json');kong_file.write_text(json.dumps(kong_config),encoding='utf-8')
        run('docker','run','-d','--pull','never','--network',ACCESS,'--name',KONG,'--label','iupc.test=history-final','-p',f'127.0.0.1:{gateway_port}:8000',
          '--mount',f'type=bind,source={kong_file},target=/tmp/kong.json,readonly','-e','KONG_DATABASE=off','-e','KONG_DECLARATIVE_CONFIG=/tmp/kong.json',
          '-e','KONG_ANONYMOUS_REPORTS=off','-e','KONG_ADMIN_LISTEN=off',IMAGES['gateway']);owned.append(KONG)
        run('docker','network','connect',NAME,KONG)
        sql("""create role anon nologin; create role authenticated nologin;
          create role service_role nologin bypassrls; create role supabase_admin nologin;
          create role supabase_auth_admin login noinherit;
          create role authenticator login noinherit;grant anon,authenticated to authenticator;
          create schema extensions;create extension pgcrypto with schema extensions;
          create extension if not exists "uuid-ossp" with schema extensions;
          create schema auth authorization supabase_auth_admin;create schema storage;
          grant usage on schema extensions to supabase_auth_admin;
          grant all on schema public to supabase_auth_admin;
        """)
        env={'GOTRUE_API_HOST':'0.0.0.0','GOTRUE_API_PORT':'9999','API_EXTERNAL_URL':f'http://127.0.0.1:{gateway_port}/auth/v1',
          'GOTRUE_DB_DRIVER':'postgres','GOTRUE_DB_DATABASE_URL':f'postgres://supabase_auth_admin@{DB}:5432/postgres?search_path=auth&sslmode=disable',
          'GOTRUE_SITE_URL':'http://127.0.0.1:5178','GOTRUE_JWT_SECRET':secret,'GOTRUE_JWT_EXP':'3600',
          'GOTRUE_JWT_AUD':'authenticated','GOTRUE_JWT_DEFAULT_GROUP_NAME':'authenticated','GOTRUE_DISABLE_SIGNUP':'false',
          'GOTRUE_EXTERNAL_EMAIL_ENABLED':'true','GOTRUE_MAILER_AUTOCONFIRM':'true','GOTRUE_RATE_LIMIT_EMAIL_SENT':'100',
          'GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED':'true'}
        args=['docker','run','-d','--pull','never','--network',NAME,'--name',AUTH,'--label','iupc.test=history-final','-p',f'127.0.0.1:{auth_port}:9999']
        for k,v in env.items():args+=['-e',k+'='+v]
        run(*args,IMAGES['auth']);owned.append(AUTH)
        try:wait_http(f'http://127.0.0.1:{gateway_port}/auth/v1/health')
        except Exception:raise RuntimeError('Auth startup failed: '+run('docker','logs',AUTH)[-2000:])
        # Auth's own migrations install the real Supabase JWT accessors.
        sql("grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid(),auth.role() to anon,authenticated,service_role;")
        for migration in sorted((ROOT/'supabase/migrations').glob('*.sql')):sql('begin;'+migration.read_text(encoding='utf-8')+'\ncommit;')
        users={};password='Fictional-local-'+secrets.token_hex(12)+'!'
        for kind in ['admin','teacher','other','admin2','revoked']:
            email=kind+'@history.example.invalid'
            created=http(f'http://127.0.0.1:{gateway_port}/auth/v1/signup',{'email':email,'password':password,'data':{'full_name':'Fictional History '+kind}})
            users[kind]={'id':created['user']['id'],'email':email,'password':password}
        fixture=(ROOT/'supabase/tests/fixtures/enrollment-history-baseline.sql').read_text(encoding='utf-8')
        fixture=fixture[fixture.index('insert into public.schools'):]
        for n,kind in [(1,'admin'),(2,'teacher'),(3,'other')]:fixture=fixture.replace(f'61000000-0000-4000-8000-{n:012}',users[kind]['id'])
        sql(fixture)
        sql("insert into public.memberships(school_id,user_id,role,active) values "+
          f"('62000000-0000-4000-8000-000000000001','{users['admin2']['id']}','admin',true),"+
          f"('62000000-0000-4000-8000-000000000001','{users['revoked']['id']}','admin',true);"+
          "insert into public.teacher_classes(school_id,teacher_id,class_id) values ('62000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001');"+
          "insert into public.teacher_subjects(school_id,teacher_id,subject_id) values ('62000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001');")
        args=['docker','run','-d','--pull','never','--network',NAME,'--name',REST,'--label','iupc.test=history-final','-p',f'127.0.0.1:{rest_port}:3000',
          '-e',f'PGRST_DB_URI=postgres://authenticator@{DB}:5432/postgres?sslmode=disable','-e','PGRST_DB_SCHEMAS=public',
          '-e','PGRST_DB_ANON_ROLE=anon','-e',f'PGRST_JWT_SECRET={secret}','-e','PGRST_DB_EXTRA_SEARCH_PATH=public,extensions']
        run(*args,IMAGES['rest']);owned.append(REST)
        wait_http(f'http://127.0.0.1:{gateway_port}/rest/v1/')
        def b64(value):return base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).decode().rstrip('=')
        content=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'role':'anon','iss':'local-disposable','exp':int(time.time())+14400})
        anon=content+'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),content.encode(),hashlib.sha256).digest()).decode().rstrip('=')
        config={'name':NAME,'db':DB,'url':f'http://127.0.0.1:{gateway_port}','anonKey':anon,'users':users,'stop':str(stop),
          'postgres':sql('show server_version;'),'images':IMAGES}
        (OUT/'local-stack.json').write_text(json.dumps(config,indent=2),encoding='utf-8')
        print('DISPOSABLE_LOCAL_STACK_READY '+NAME+'; PostgreSQL '+config['postgres'],flush=True)
        print('STOP_MARKER='+str(stop),flush=True)
        while not stop.exists():time.sleep(.5)
    finally:
        for name in reversed(owned):
            subprocess.run(['docker','stop','-t','3',name],capture_output=True)
            subprocess.run(['docker','rm',name],capture_output=True)
        if network:
            subprocess.run(['docker','network','rm',NAME],capture_output=True)
            subprocess.run(['docker','network','rm',ACCESS],capture_output=True)
        # All credentials are disposable; remove the runtime credential file.
        runtime=OUT/'local-stack.json'
        if runtime.is_file() and json.loads(runtime.read_text()).get('name')==NAME:runtime.unlink()

if __name__=='__main__':main()
