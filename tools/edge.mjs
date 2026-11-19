// SPDX-License-Identifier: AGPL-3.0-or-later
// Edge (or Chrome) without a window, with WebGPU, controlled over CDP with the built-in WebSocket
// of Node 22. Browser from EDGE or the newest EdgeCore folder. Start from PowerShell: from
// Git Bash, headless Edge produces no images.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const CORE = 'C:\\Program Files (x86)\\Microsoft\\EdgeCore';
const byVersion = ( a, b ) => a.split( '.' ).map( Number ).reduce( ( d, x, i ) => d || x - Number( b.split( '.' )[ i ] ), 0 );
export const sleep = ( ms ) => new Promise( r => setTimeout( r, ms ) );

// Opens url at w × h, waits until Facette is ready and returns helpers.
// dir: folder for the throwaway profile
export async function openPage( url, { w, h, dpr = 1, dir } ) {

	const edgeExe = process.env.EDGE || ( existsSync( CORE ) ? path.join( CORE, readdirSync( CORE ).filter( v => /^\d+\./.test( v ) ).sort( byVersion ).pop(), 'msedge.exe' ) : 'msedge' );
	const port = 9300 + Math.floor( Math.random() * 500 );
	const profile = path.join( dir, 'profile-' + port );
	mkdirSync( profile, { recursive: true } );

	const edge = spawn( edgeExe, [
		'--headless=new', '--no-first-run', '--disable-extensions', '--disable-sync', '--disable-background-networking',
		'--disable-component-update', '--mute-audio', '--hide-scrollbars', '--enable-unsafe-webgpu',
		'--user-data-dir=' + profile, '--remote-debugging-port=' + port, '--window-size=' + w + ',' + h, 'about:blank'
	], { stdio: 'ignore' } );

	let ws, id = 0;
	const pending = new Map();
	const send = ( method, params = {} ) => new Promise( ( res, rej ) => {

		const i = ++ id;
		pending.set( i, { res, rej } );
		ws.send( JSON.stringify( { id: i, method, params } ) );

	} );

	const close = async () => {

		try { ws?.close(); } catch {}
		edge.kill();
		await sleep( 500 );
		try { rmSync( profile, { recursive: true, force: true } ); } catch {}

	};

	try {

		let list = [];
		for ( let k = 0; k < 60; k ++ ) {

			try { list = await ( await fetch( `http://127.0.0.1:${ port }/json` ) ).json(); if ( list.some( t => t.type === 'page' ) ) break; } catch {}
			await sleep( 250 );

		}

		const page = list.find( t => t.type === 'page' );
		if ( ! page ) throw new Error( 'Edge does not respond' );
		ws = new WebSocket( page.webSocketDebuggerUrl );
		await new Promise( r => ws.addEventListener( 'open', r ) );
		ws.addEventListener( 'message', ( e ) => {

			const m = JSON.parse( e.data );
			if ( m.id && pending.has( m.id ) ) { const p = pending.get( m.id ); pending.delete( m.id ); m.error ? p.rej( new Error( m.error.message ) ) : p.res( m.result ); }
			if ( m.method === 'Runtime.exceptionThrown' ) console.log( 'Exception:', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text );
			if ( m.method === 'Runtime.consoleAPICalled' && [ 'error', 'warning' ].includes( m.params.type ) ) console.log( 'Console ' + m.params.type + ':', m.params.args.map( a => a.value ?? a.description ).join( ' ' ).slice( 0, 300 ) );

		} );

		await send( 'Runtime.enable' );
		await send( 'Page.enable' );
		await send( 'Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false } );
		await send( 'Page.navigate', { url } );

	} catch ( e ) {

		await close();
		throw e;

	}

	const ev = async ( expr ) => {

		const r = await send( 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true } );
		if ( r.exceptionDetails ) throw new Error( r.exceptionDetails.exception?.description || r.exceptionDetails.text );
		return r.result.value;

	};

	for ( let k = 0; k < 120; k ++ ) {

		await sleep( 250 );
		try { if ( await ev( 'document.body.classList.contains("ready") && !!window.viewer' ) ) break; } catch {}

	}

	const screenshot = async () => Buffer.from( ( await send( 'Page.captureScreenshot', { format: 'png', optimizeForSpeed: true } ) ).data, 'base64' );

	// Click like a mouse
	const click = async ( x, y ) => {

		await send( 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y } );
		await send( 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 } );
		await send( 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 } );

	};

	return { ev, send, screenshot, click, close };

}
