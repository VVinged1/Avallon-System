import ListItem from '@mui/material/ListItem';
import Input from '@mui/material/Input';
import VisibilityOffRounded from '@mui/icons-material/VisibilityOffRounded';
import {InitiativeItem} from './InitiativeItem';
import {focusInitiativeItem} from './focusInitiativeItem';
type InitiativeListItemProps={initiative:InitiativeItem;onCountChange:(count:string)=>void;showHidden:boolean;editable:boolean};
export function InitiativeListItem({initiative,onCountChange,showHidden,editable}:InitiativeListItemProps){
 if(!initiative.visible&&!showHidden)return null;
 return <ListItem className="initiative-card" data-initiative-id={initiative.id} data-active={initiative.active}
   selected={initiative.active} onClick={()=>void focusInitiativeItem(initiative.id)}
   sx={{width:132,flex:'0 0 132px',height:88,p:1,display:'flex',flexDirection:'column',alignItems:'stretch',border:'1px solid',borderColor:initiative.active?'primary.main':'divider',borderRadius:'8px',cursor:'pointer',backgroundColor:initiative.active?'action.selected':'background.paper'}}>
   <button type="button" className="initiative-focus" title={initiative.name} aria-label={'Focus '+initiative.name}
     onClick={event=>{event.stopPropagation();void focusInitiativeItem(initiative.id);}}>
     {!initiative.visible&&<VisibilityOffRounded sx={{fontSize:13,mr:.5,opacity:.6}}/>}{initiative.name}
   </button>
   <Input disableUnderline disabled={!editable} value={initiative.count}
     inputProps={{'aria-label':'Initiative for '+initiative.name,inputMode:'decimal',sx:{textAlign:'center',fontSize:22,fontWeight:700,p:0}}}
     sx={{width:'100%',mt:'auto','& .MuiInputBase-input.Mui-disabled':{WebkitTextFillColor:'#f2e5ce',opacity:1}}} onChange={event=>onCountChange(event.target.value)}
     onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()}/>
 </ListItem>;
}
