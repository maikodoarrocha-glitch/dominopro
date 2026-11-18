import React from 'react';

// Posições dos pontos em cada metade (grade 3×3)
const PIPS = {
  0: [],
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
};

function Half({ v }) {
  const positions = PIPS[v] || [];
  return (
    <div className="half">
      {positions.map(([c, r], i) => (
        <span
          key={i}
          className="pip"
          style={{ gridColumn: c + 1, gridRow: r + 1 }}
        />
      ))}
    </div>
  );
}

/**
 * Peça de dominó.
 * @param {number} a valor da metade esquerda
 * @param {number} b valor da metade direita
 * @param {'h'|'v'} dir horizontal (normal) ou vertical (dupla)
 * @param {'board'|'hand'|'mini'|'back'} size
 */
export default function Tile({ a, b, dir = 'h', size = 'board', back = false, className = '', ...rest }) {
  return (
    <div
      className={`tile tile-${dir} tile-${size} ${back ? 'tile-is-back' : ''} ${className}`}
      {...rest}
    >
      {back ? (
        <div className="tile-back">
          <span className="tile-back-mark">◆</span>
        </div>
      ) : (
        <>
          <Half v={a} />
          <span className="tile-divider" />
          <Half v={b} />
        </>
      )}
    </div>
  );
}
