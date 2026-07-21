declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.css' {}

// react-toastify CSS imported transitively via PDS Toaster component types
declare module 'react-toastify/dist/ReactToastify.css' {}
declare module 'react-toastify/dist/ReactToastify.min.css' {}
