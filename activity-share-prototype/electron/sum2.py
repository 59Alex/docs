import json,sys
for l in open(sys.argv[1]):
    o=json.loads(l); d=o['data']; n=o['name']; st=o['step']
    if st=='summary':
        v=d['viewers']
        print(n,'| fps',[x['fps'] for x in v],'res',v[0]['res'],'lat50',[x['latP50'] for x in v],'lat95',[x['latP95'] for x in v],'aud50',[x['audioLatP50'] for x in v],'av',[x['avOffsetP50'] for x in v],'jb',[x['jb'] for x in v],'aJb',[x['aJb'] for x in v],'drop',[x['dropped'] for x in v],'stat',[(x.get('statFps'),x.get('statRes'),x.get('kbpsIn')) for x in v],'spread',d['spreadP50'],d['spreadP95'],d['spreadN'])
        print('    sender',d['senderSeries'][-1])
    elif st=='frame-capture': print(n,'| capture',d.get('mode'),d.get('local'),'audio',d.get('audio'),d.get('audioRms'),d.get('error'))
    elif st=='captureStream-in-page': print(n,'| captureStream',d['player'],'webSec',d['webSecurity'],d['res'])
    elif st in ('control','error','load-error'): print(n,'|',st,json.dumps(d)[:300])
    elif st=='scan': print(n,'| scan frames',d['frames'],'players',[(p['tag'],p['w'],p['h'],p['vw'],p['vh'],p['inFrame'],p.get('drm')) for p in d['players']])
