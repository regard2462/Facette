// SPDX-License-Identifier: AGPL-3.0-or-later
// Small static server for development: node server.mjs [port]  (environment: PORT, HOST)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath( new URL( '.', import.meta.url ) );
const port = Number( process.argv[ 2 ] || process.env.PORT || 5199 );
// HOST=0.0.0.0 exposes the server on the local network. Note: over a network address with http
// there is no WebGPU (only localhost counts as a secure context), so a phone shows WebGL 2.
const host = process.env.HOST || '127.0.0.1';
const types = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
	'.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml',
	'.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
	'.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm'
};
// only what the page needs; the rest of the project folder stays hidden
const allowed = [ 'index.html', 'src/', 'node_modules/three/', 'preview/', 'models/' ];
// Windows opens a device instead of a file for these names
const device = /(^|\/)(con|prn|aux|nul|com\d|lpt\d)(\.|\/|$)/i;

const server = createServer( async ( req, res ) => {

	let path;

	try {

		path = decodeURIComponent( new URL( req.url, 'http://x' ).pathname );

	} catch {

		res.writeHead( 400 ).end();
		return;

	}

	if ( path.endsWith( '/' ) ) path += 'index.html';
	const file = normalize( join( root, path ) );
	if ( ! file.startsWith( root ) ) { res.writeHead( 403 ).end(); return; }
	const rel = relative( root, file ).split( sep ).join( '/' );

	if ( ! allowed.some( a => a.endsWith( '/' ) ? rel.startsWith( a ) : rel === a ) || device.test( rel ) ) {

		res.writeHead( 404 ).end( 'not found' );
		return;

	}

	try {

		const data = await readFile( file );
		// Three does not change, own files do
		const cache = rel.startsWith( 'node_modules/' ) ? 'max-age=3600' : 'no-store';
		res.writeHead( 200, { 'Content-Type': types[ extname( file ) ] || 'application/octet-stream', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' } );
		res.end( data );

	} catch ( e ) {

		res.writeHead( e.code === 'ENOENT' || e.code === 'EISDIR' ? 404 : 500 ).end( 'not found' );

	}

} );

server.on( 'error', e => {

	console.error( e.code === 'EADDRINUSE' ? `Port ${ port } is in use. Choose another port: node server.mjs 8080` : e.message );
	process.exit( 1 );

} );

server.listen( port, host, () => console.log( `http://${ host }:${ port }/` ) );
