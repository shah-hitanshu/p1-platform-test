/**
 * Puck Configuration
 *
 * Defines the components available in the Puck editor.
 */

import type { Config } from '@measured/puck';
import React from 'react';

// Component props types
interface HeadingProps {
  text: string;
  level: 'h1' | 'h2' | 'h3';
  align: 'left' | 'center' | 'right';
}

interface TextProps {
  content: string;
  size: 'small' | 'medium' | 'large';
}

interface ImageProps {
  src: string;
  alt: string;
  width: 'full' | 'half' | 'third';
}

interface ButtonProps {
  label: string;
  url: string;
  variant: 'primary' | 'secondary' | 'outline';
}

interface SpacerProps {
  size: 'small' | 'medium' | 'large';
}

interface CardProps {
  title: string;
  description: string;
  imageUrl: string;
}

interface ColumnsProps {
  columns: '2' | '3' | '4';
}

// Component definitions
type Components = {
  Heading: HeadingProps;
  Text: TextProps;
  Image: ImageProps;
  Button: ButtonProps;
  Spacer: SpacerProps;
  Card: CardProps;
  Columns: ColumnsProps;
};

// Puck configuration
export const puckConfig: Config<Components> = {
  components: {
    Heading: {
      label: 'Heading',
      defaultProps: {
        text: 'Heading',
        level: 'h2',
        align: 'left',
      },
      fields: {
        text: { type: 'text' },
        level: {
          type: 'select',
          options: [
            { label: 'H1', value: 'h1' },
            { label: 'H2', value: 'h2' },
            { label: 'H3', value: 'h3' },
          ],
        },
        align: {
          type: 'radio',
          options: [
            { label: 'Left', value: 'left' },
            { label: 'Center', value: 'center' },
            { label: 'Right', value: 'right' },
          ],
        },
      },
      render: ({ text, level, align }) => {
        const Tag = level;
        return (
          <Tag
            style={{
              textAlign: align,
              margin: '0 0 1rem',
              fontWeight: 600,
            }}
          >
            {text}
          </Tag>
        );
      },
    },

    Text: {
      label: 'Text',
      defaultProps: {
        content: 'Enter your text here...',
        size: 'medium',
      },
      fields: {
        content: { type: 'textarea' },
        size: {
          type: 'select',
          options: [
            { label: 'Small', value: 'small' },
            { label: 'Medium', value: 'medium' },
            { label: 'Large', value: 'large' },
          ],
        },
      },
      render: ({ content, size }) => {
        const fontSize = {
          small: '0.875rem',
          medium: '1rem',
          large: '1.25rem',
        }[size];

        return (
          <p style={{ fontSize, lineHeight: 1.6, margin: '0 0 1rem' }}>
            {content}
          </p>
        );
      },
    },

    Image: {
      label: 'Image',
      defaultProps: {
        src: 'https://via.placeholder.com/800x400',
        alt: 'Placeholder image',
        width: 'full',
      },
      fields: {
        src: { type: 'text', label: 'Image URL' },
        alt: { type: 'text', label: 'Alt Text' },
        width: {
          type: 'select',
          options: [
            { label: 'Full Width', value: 'full' },
            { label: 'Half Width', value: 'half' },
            { label: 'Third Width', value: 'third' },
          ],
        },
      },
      render: ({ src, alt, width }) => {
        const widthStyle = {
          full: '100%',
          half: '50%',
          third: '33.33%',
        }[width];

        return (
          <img
            src={src}
            alt={alt}
            style={{
              width: widthStyle,
              height: 'auto',
              borderRadius: '8px',
              marginBottom: '1rem',
            }}
          />
        );
      },
    },

    Button: {
      label: 'Button',
      defaultProps: {
        label: 'Click me',
        url: '#',
        variant: 'primary',
      },
      fields: {
        label: { type: 'text' },
        url: { type: 'text', label: 'Link URL' },
        variant: {
          type: 'select',
          options: [
            { label: 'Primary', value: 'primary' },
            { label: 'Secondary', value: 'secondary' },
            { label: 'Outline', value: 'outline' },
          ],
        },
      },
      render: ({ label, url, variant }) => {
        const styles: Record<string, React.CSSProperties> = {
          primary: {
            background: '#4f46e5',
            color: 'white',
            border: 'none',
          },
          secondary: {
            background: '#e5e5e5',
            color: '#333',
            border: 'none',
          },
          outline: {
            background: 'transparent',
            color: '#4f46e5',
            border: '2px solid #4f46e5',
          },
        };

        return (
          <a
            href={url}
            style={{
              display: 'inline-block',
              padding: '0.75rem 1.5rem',
              borderRadius: '6px',
              textDecoration: 'none',
              fontWeight: 500,
              cursor: 'pointer',
              marginBottom: '1rem',
              ...styles[variant],
            }}
          >
            {label}
          </a>
        );
      },
    },

    Spacer: {
      label: 'Spacer',
      defaultProps: {
        size: 'medium',
      },
      fields: {
        size: {
          type: 'select',
          options: [
            { label: 'Small (1rem)', value: 'small' },
            { label: 'Medium (2rem)', value: 'medium' },
            { label: 'Large (4rem)', value: 'large' },
          ],
        },
      },
      render: ({ size }) => {
        const height = {
          small: '1rem',
          medium: '2rem',
          large: '4rem',
        }[size];

        return <div style={{ height }} />;
      },
    },

    Card: {
      label: 'Card',
      defaultProps: {
        title: 'Card Title',
        description: 'Card description goes here.',
        imageUrl: 'https://via.placeholder.com/400x200',
      },
      fields: {
        title: { type: 'text' },
        description: { type: 'textarea' },
        imageUrl: { type: 'text', label: 'Image URL' },
      },
      render: ({ title, description, imageUrl }) => (
        <div
          style={{
            border: '1px solid #ddd',
            borderRadius: '8px',
            overflow: 'hidden',
            marginBottom: '1rem',
          }}
        >
          <img
            src={imageUrl}
            alt={title}
            style={{ width: '100%', height: 'auto' }}
          />
          <div style={{ padding: '1rem' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.125rem' }}>
              {title}
            </h3>
            <p style={{ margin: 0, color: '#666', fontSize: '0.875rem' }}>
              {description}
            </p>
          </div>
        </div>
      ),
    },

    Columns: {
      label: 'Columns',
      defaultProps: {
        columns: '2',
      },
      fields: {
        columns: {
          type: 'select',
          options: [
            { label: '2 Columns', value: '2' },
            { label: '3 Columns', value: '3' },
            { label: '4 Columns', value: '4' },
          ],
        },
      },
      render: ({ columns }) => {
        const gridColumns = {
          '2': '1fr 1fr',
          '3': '1fr 1fr 1fr',
          '4': '1fr 1fr 1fr 1fr',
        }[columns];

        return (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: gridColumns,
              gap: '1rem',
              marginBottom: '1rem',
            }}
          >
            {Array.from({ length: parseInt(columns) }).map((_, i) => (
              <div
                key={i}
                style={{
                  background: '#f5f5f5',
                  padding: '2rem',
                  borderRadius: '4px',
                  textAlign: 'center',
                  color: '#666',
                }}
              >
                Column {i + 1}
              </div>
            ))}
          </div>
        );
      },
    },
  },
};
