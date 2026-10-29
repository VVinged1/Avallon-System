import {createTheme,ThemeProvider} from '@mui/material/styles';
import React from 'react';
const theme=createTheme({palette:{mode:'dark',primary:{main:'#d3ad6b'},secondary:{main:'#b8757d'},background:{default:'#181411',paper:'#261f1a'},text:{primary:'#f2e5ce',secondary:'#c1ae91'},divider:'#66513b'},shape:{borderRadius:9},typography:{fontFamily:'Segoe UI, system-ui, sans-serif',h6:{fontFamily:'Georgia,serif'}},components:{MuiButtonBase:{defaultProps:{disableRipple:true}},MuiCardHeader:{styleOverrides:{root:{background:'#30231e'}}}}});
export function PluginThemeProvider({children}:{children?:React.ReactNode}){return <ThemeProvider theme={theme}>{children}</ThemeProvider>;}
