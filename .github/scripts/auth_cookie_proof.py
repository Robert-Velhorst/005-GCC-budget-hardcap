"""Hosted-only source and malformed-cookie behavioral proof."""
import datetime,hashlib,json,os,pathlib,subprocess,sys
assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('RUNNER_ENVIRONMENT')=='github-hosted'
assert os.environ.get('GITHUB_REPOSITORY')=='Robert-Velhorst/005-GCC-budget-hardcap'
root=pathlib.Path(__file__).resolve().parents[2];out=root/'AUTH_COOKIE_EVIDENCE';out.mkdir(exist_ok=True)
def git(*args):return subprocess.check_output(['git','-C',str(root),*args])
def snapshot():
    rows={}
    for row in git('ls-tree','-rz','HEAD').split(b'\0'):
        if not row:continue
        header,name=row.split(b'\t');mode,kind,blob=header.decode().split();assert kind=='blob';p=root/os.fsdecode(name);raw=os.readlink(p).encode() if mode=='120000' else p.read_bytes()
        assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()==blob
        rows[os.fsdecode(name)]={'blob':blob,'sha256':hashlib.sha256(raw).hexdigest()}
    return rows
before=snapshot();(out/'source-before.json').write_text(json.dumps(before,indent=2));node=subprocess.check_output(['node','--version']).decode().strip();assert node=='v26.12.1'
original=out/'original-auth.cjs';original.write_bytes(git('show','67844d2fafd0afac25fe53c5f97ad8b649fad6e8:src/control/auth.js'))
record={'captured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':git('rev-parse','HEAD').decode().strip(),'tree':git('rev-parse','HEAD^{tree}').decode().strip(),'node':node,'new_external_dependencies':0,'original_cases_helpers_assertions_selectors_timeouts_commands_changed':False,'full_SDK_native_database_deployment_or_operator_acceptance':False}
try:
    for label,source in [('original',original),('patched',root/'src/control/auth.js')]:
        result=subprocess.run(['node',str(root/'.github/qualification/auth-cookie-cases.cjs'),str(source)],cwd=root,capture_output=True,text=True,timeout=60)
        (out/(label+'-cases.log')).write_text(result.stdout+result.stderr);actual=json.loads(result.stdout);record[label]=actual
        assert actual['cases']==18 and actual['skipped']==0
        if label=='original':assert result.returncode!=0 and actual['failed']==12 and actual['passed']==6
        else:assert result.returncode==0 and actual['passed']==18 and actual['failed']==0
    record['component_acceptance']=True
finally:
    after=snapshot();(out/'source-after.json').write_text(json.dumps(after,indent=2));record['all_tracked_source_unchanged']=before==after
    (out/'receipt.json').write_text(json.dumps(record,indent=2));assert before==after
