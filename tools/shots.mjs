// SPDX-License-Identifier: AGPL-3.0-or-later
// Image check without a window: sets view and camera by script and saves images next to the
// job file. Start from PowerShell, the server must be running:
// node tools/shots.mjs <jobs.json>
// jobs.json: { "url": "...", "w": 800, "h": 500, "shots": [ { "js": "...", "wait": 1500, "out": "a.png" } ] }
// If the script returns { click: [x, y] }, the tool clicks there like a mouse.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openPage, sleep } from './edge.mjs';

// PowerShell 5.1 writes UTF-8 with BOM, which JSON.parse rejects
const job = JSON.parse( readFileSync( process.argv[ 2 ], 'utf8' ).replace( /^\uFEFF/, '' ) );
const dir = path.dirname( path.resolve( process.argv[ 2 ] ) );

let b;
try {

	b = await openPage( job.url, { w: job.w, h: job.h, dpr: job.dpr, dir } );
	console.log( 'ready:', JSON.stringify( await b.ev( '({ gpu: viewer.isWebGPU, q: viewer.state.quality })' ) ) );

	for ( const s of job.shots ) {

		const v = s.js ? await b.ev( '(async () => { ' + s.js + ' })()' ) : null;
		if ( v !== undefined && v !== null ) console.log( s.out, '→', JSON.stringify( v ) );
		if ( v && v.click ) { await sleep( 300 ); await b.click( ...v.click ); }
		await sleep( s.wait ?? 1500 );
		if ( s.out ) writeFileSync( path.join( dir, s.out ), await b.screenshot() );

	}

	console.log( 'Errors:', JSON.stringify( await b.ev( 'window.__errs || []' ) ) );

} catch ( e ) {

	console.log( 'Aborted:', e.message );

} finally {

	await b?.close();

}
