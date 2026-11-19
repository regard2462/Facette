// SPDX-License-Identifier: AGPL-3.0-or-later
// Light gizmo: floor ring (rotation), arc (elevation) and draggable light point.
// Drawn as SVG over the image so depth of field and bloom do not touch it.
import { Raycaster, Vector2, Vector3 } from 'three';

const NS = 'http://www.w3.org/2000/svg';
const RAD = Math.PI / 180;
const EL_MIN = 15, EL_MAX = 88;

export class LightGizmo {

	// get() returns { az, el } in degrees, set( az, el ) takes new values
	constructor( { svg, camera, controls, center, radius = 2.2, get, set } ) {

		Object.assign( this, { svg, camera, controls, center, radius, get, set } );
		this.ray = new Raycaster();
		this.drag = null;
		this._v = new Vector3();
		this._p = new Vector3();
		this._head = new Vector3();

		const el = ( tag, cls ) => { const n = document.createElementNS( NS, tag ); n.setAttribute( 'class', cls ); svg.append( n ); return n; };
		this.ring = el( 'path', 'line' );
		this.arc = el( 'path', 'line' );
		this.stem = el( 'path', 'line faint' );
		this.ringHit = el( 'path', 'hit' );
		this.arcHit = el( 'path', 'hit' );
		this.dot = el( 'circle', 'dot' );
		this.dotHit = el( 'circle', 'hit fill' );
		this.dot.setAttribute( 'r', 6 );
		this.dotHit.setAttribute( 'r', 18 );

		for ( const [ node, kind ] of [ [ this.ringHit, 'ring' ], [ this.arcHit, 'arc' ], [ this.dotHit, 'dot' ] ] ) {

			node.addEventListener( 'pointerdown', e => this._down( e, kind, node ) );
			node.addEventListener( 'pointermove', e => this._move( e ) );
			node.addEventListener( 'pointerup', e => this._up( e, node ) );
			node.addEventListener( 'pointercancel', e => this._up( e, node ) );

		}

	}

	get visible() { return ! this.svg.hasAttribute( 'hidden' ); }

	show( on ) {

		if ( on ) this.svg.removeAttribute( 'hidden' ); else { this.svg.setAttribute( 'hidden', '' ); this._release(); }

	}

	_point( az, el, out ) {

		const a = az * RAD, e = el * RAD;
		return out.set( Math.sin( a ) * Math.cos( e ), Math.sin( e ), Math.cos( a ) * Math.cos( e ) ).multiplyScalar( this.radius ).add( this.center );

	}

	_screen( p ) {

		const v = this._v.copy( p ).project( this.camera );
		if ( v.z > 1 || v.z < - 1 ) return null; // behind the camera
		return [ ( v.x + 1 ) / 2 * this.w, ( 1 - v.y ) / 2 * this.h ];

	}

	_path( points ) {

		let d = '', pen = false;

		for ( const p of points ) {

			const s = this._screen( p );
			if ( ! s ) { pen = false; continue; }
			d += ( pen ? 'L' : 'M' ) + s[ 0 ].toFixed( 1 ) + ' ' + s[ 1 ].toFixed( 1 );
			pen = true;

		}

		return d;

	}

	// Line of n + 1 points, f( i, out ) writes point i into out
	_pathFn( n, f ) {

		let d = '', pen = false;

		for ( let i = 0; i <= n; i ++ ) {

			const s = this._screen( f( i, this._p ) );
			if ( ! s ) { pen = false; continue; }
			d += ( pen ? 'L' : 'M' ) + s[ 0 ].toFixed( 1 ) + ' ' + s[ 1 ].toFixed( 1 );
			pen = true;

		}

		return d;

	}

	update() {

		// The SVG sits fixed over the whole window: window size instead of a layout query
		this.w = innerWidth; this.h = innerHeight;
		// Size follows the image section so that arc and light point stay in the picture at every zoom
		const cam = this.camera;
		if ( ! this.drag ) this.radius = cam.position.distanceTo( this.center ) * Math.tan( cam.fov * RAD / 2 ) * 0.8 * Math.min( 1, cam.aspect );
		const { az, el } = this.get();
		const ring = this._pathFn( 120, ( i, p ) => this._point( i * 3, 0, p ) );
		this.ring.setAttribute( 'd', ring ); this.ringHit.setAttribute( 'd', ring );

		const arc = this._pathFn( 60, ( i, p ) => this._point( az, i * 3, p ) );
		this.arc.setAttribute( 'd', arc ); this.arcHit.setAttribute( 'd', arc );

		const head = this._point( az, el, this._head );
		this.stem.setAttribute( 'd', this._path( [ this.center, head ] ) );
		const s = this._screen( head );

		for ( const n of [ this.dot, this.dotHit ] ) {

			n.style.display = s ? '' : 'none';
			if ( s ) { n.setAttribute( 'cx', s[ 0 ] ); n.setAttribute( 'cy', s[ 1 ] ); }

		}

	}

	_aim( e ) {

		const r = this.svg.getBoundingClientRect();
		this.ray.setFromCamera( new Vector2( ( e.clientX - r.left ) / r.width * 2 - 1, - ( e.clientY - r.top ) / r.height * 2 + 1 ), this.camera );
		return this.ray.ray;

	}

	// Angle about the vertical axis at which the pointer hits the floor plane
	_groundAngle( e ) {

		const ray = this._aim( e );
		if ( ray.direction.y > - 1e-3 ) return null;
		const t = ( this.center.y - ray.origin.y ) / ray.direction.y;
		return Math.atan2( ray.origin.x + ray.direction.x * t - this.center.x, ray.origin.z + ray.direction.z * t - this.center.z ) / RAD;

	}

	_down( e, kind, node ) {

		if ( ! e.isPrimary || e.button !== 0 ) return;
		e.preventDefault();
		node.setPointerCapture( e.pointerId );
		const { az, el } = this.get();
		const head = this._point( az, el, new Vector3() );
		// front or back half of the sphere: stays the same for the duration of the drag
		const front = head.sub( this.center ).dot( this._v.copy( this.camera.position ).sub( this.center ) ) > 0;
		this.drag = { kind, az, el, y: e.clientY, angle: kind === 'ring' ? this._groundAngle( e ) : null, front };
		this.controls.enabled = false;
		this.svg.classList.add( 'dragging' );

	}

	_move( e ) {

		const g = this.drag;
		if ( ! g || ! e.isPrimary ) return;
		let { az, el } = this.get();

		if ( g.kind === 'ring' ) {

			const a = this._groundAngle( e );
			if ( a === null || g.angle === null ) return;
			az = g.az + a - g.angle;

		} else if ( g.kind === 'arc' ) {

			el = g.el - ( e.clientY - g.y ) * 0.3;

		} else {

			// Intersect the pointer ray with the sphere; if it misses, the nearest point on the rim applies
			const ray = this._aim( e );
			const oc = this._v.copy( ray.origin ).sub( this.center );
			const b = oc.dot( ray.direction ), disc = b * b - ( oc.lengthSq() - this.radius * this.radius );
			const t = disc < 0 ? - b : - b + ( g.front ? - 1 : 1 ) * Math.sqrt( disc );
			const d = oc.addScaledVector( ray.direction, t ).normalize();
			el = Math.asin( Math.max( - 1, Math.min( 1, d.y ) ) ) / RAD;
			az = Math.atan2( d.x, d.z ) / RAD;

		}

		az = ( ( az + 180 ) % 360 + 360 ) % 360 - 180;
		el = Math.max( EL_MIN, Math.min( EL_MAX, el ) );
		this.set( Math.round( az ), Math.round( el ) );

	}

	_up( e, node ) {

		if ( node.hasPointerCapture( e.pointerId ) ) node.releasePointerCapture( e.pointerId );
		this._release();

	}

	_release() {

		if ( ! this.drag ) return;
		this.drag = null;
		this.controls.enabled = true;
		this.svg.classList.remove( 'dragging' );

	}

}
