// SPDX-License-Identifier: AGPL-3.0-or-later
// Record video frame by frame. A demo script (script for the page, see demo-script.js) sets
// camera, light and focus for every time t. The page then renders a few frames so that
// anti-aliasing and lens filters settle, and the tool captures the frame. This keeps the
// video smooth no matter how long a frame takes. ffmpeg assembles an MP4 at the end.
// Start from PowerShell, the server must be running:
// node tools/video.mjs tools/demo-script.js demo.mp4 --parts light,dark
// Options: --url (default http://127.0.0.1:5199/?q=high), --w 1920 --h 1080 --fps 30,
//   --settle 4 (rendered frames per capture), --from/--to (seconds per part, for test runs),
//   --every n (only every n-th frame, for test runs), --frames (keep the single frames)
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { openPage } from './edge.mjs';

const [ scriptFile, output, ...rest ] = process.argv.slice( 2 );
if ( ! scriptFile || ! output ) {

	console.log( 'Usage: node tools/video.mjs <demo-script.js> <output.mp4> [--parts a,b] [--from s] [--to s] [--every n]' );
	process.exit( 1 );

}

const opt = { url: 'http://127.0.0.1:5199/?q=high', w: 1920, h: 1080, fps: 30, settle: 4, every: 1, parts: '' };
for ( let i = 0; i < rest.length; i ++ ) {

	const k = rest[ i ].replace( /^--/, '' );
	if ( k === 'frames' ) { opt.frames = true; continue; }
	const v = rest[ ++ i ];
	opt[ k ] = /^-?\d+(\.\d+)?$/.test( v ) ? Number( v ) : v;

}

const target = path.resolve( output );
const dir = target.replace( /\.mp4$/i, '' ) + '-frames';
rmSync( dir, { recursive: true, force: true } );
mkdirSync( dir, { recursive: true } );

let b, n = 0;
try {

	b = await openPage( opt.url, { w: opt.w, h: opt.h, dir: path.dirname( target ) } );
	await b.ev( readFileSync( scriptFile, 'utf8' ) );
	// wait for k rendered frames (the page renders in requestAnimationFrame)
	await b.ev( 'window.__wait = ( k ) => new Promise( r => { let i = 0; const f = () => ++ i > k ? r() : requestAnimationFrame( f ); requestAnimationFrame( f ); } ); 1' );
	const parts = opt.parts ? String( opt.parts ).split( ',' ) : await b.ev( 'Object.keys( demoScript.parts )' );

	for ( const part of parts ) {

		const duration = await b.ev( `demoScript.start( ${ JSON.stringify( part ) } ).then( () => __wait( 40 ) ).then( () => demoScript.parts[ ${ JSON.stringify( part ) } ].duration )` );
		const from = Math.round( ( opt.from ?? 0 ) * opt.fps ), to = Math.round( Math.min( opt.to ?? duration, duration ) * opt.fps );
		const t0 = Date.now();
		console.log( `${ part }: ${ ( to - from ) / opt.fps } s, ${ Math.ceil( ( to - from ) / opt.every ) } frames` );

		for ( let i = from; i < to; i += opt.every ) {

			await b.ev( `demoScript.frame( ${ i / opt.fps } ).then( () => __wait( ${ opt.settle } ) )` );
			writeFileSync( path.join( dir, 'f' + String( n ++ ).padStart( 5, '0' ) + '.png' ), await b.screenshot() );
			if ( n % 150 === 0 ) console.log( `  ${ ( i / opt.fps ).toFixed( 1 ) } s, ${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 0 ) } s elapsed` );

		}

	}

	console.log( 'Errors:', JSON.stringify( await b.ev( 'window.__errs || []' ) ) );

} catch ( e ) {

	console.log( 'Aborted:', e.message );
	process.exitCode = 1;

} finally {

	await b?.close();

}

if ( n > 0 && ! process.exitCode ) {

	const r = spawnSync( 'ffmpeg', [ '-v', 'error', '-y', '-framerate', String( opt.fps / opt.every ), '-i', path.join( dir, 'f%05d.png' ),
		'-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target ], { stdio: 'inherit' } );
	if ( r.status === 0 ) {

		console.log( 'written:', target );
		if ( ! opt.frames ) rmSync( dir, { recursive: true, force: true } );

	} else process.exitCode = 1;

}
