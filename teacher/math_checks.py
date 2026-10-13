"""Exact bounded single-variable polynomial checks; no arbitrary execution.

Only arithmetic, one Latin variable, parentheses and small integer powers.
Unsupported mathematical notation remains an explicit human/AI review item.
"""
import ast
from fractions import Fraction
import re
import unicodedata


def polynomial(expression: str) -> tuple[str | None, dict[int,Fraction]]:
    if len(expression)>200 or re.search(r"[0-9]\s+[0-9]",expression):
        raise ValueError("Unsupported expression length/spacing")
    text=unicodedata.normalize("NFC",expression).lower().translate(str.maketrans({"−":"-","–":"-","×":"*","·":"*",",":"."})).replace("²","**2").replace("³","**3").replace("^","**")
    text=re.sub(r"\s+","",text)
    variables=set(re.findall(r"[a-z]",text))
    if len(variables)>1 or not re.fullmatch(r"[a-z0-9.+*/()\-]+",text):
        raise ValueError("Only single-variable polynomials supported")
    variable=next(iter(variables),None)
    text=re.sub(r"([0-9)])([a-z(])",r"\1*\2",text)
    text=re.sub(r"([a-z])([(])",r"\1*\2",text)
    text=re.sub(r"([)])([0-9])",r"\1*\2",text)
    try:
        tree=ast.parse(text,mode="eval")
    except (SyntaxError,RecursionError) as error:
        raise ValueError("Invalid polynomial") from error
    if len(list(ast.walk(tree)))>100:
        raise ValueError("Polynomial too complex")
    def bounded(value):
        result={degree:coefficient for degree,coefficient in value.items() if coefficient}
        if any(degree>12 or abs(coefficient)>10**12 or coefficient.denominator>10**12 for degree,coefficient in result.items()):
            raise ValueError("Polynomial out of bounds")
        return result
    def add(left,right,sign=1):
        out=dict(left)
        for power,value in right.items(): out[power]=out.get(power,Fraction(0))+sign*value
        return bounded(out)
    def multiply(left,right):
        out={}
        for a,va in left.items():
            for b,vb in right.items(): out[a+b]=out.get(a+b,Fraction(0))+va*vb
        return bounded(out)
    def visit(node,depth=0):
        if depth>20: raise ValueError("Polynomial too deep")
        if isinstance(node,ast.Constant) and type(node.value) in (int,float):
            return bounded({0:Fraction(ast.get_source_segment(text,node))})
        if isinstance(node,ast.Name) and node.id==variable:
            return {1:Fraction(1)}
        if isinstance(node,ast.UnaryOp) and isinstance(node.op,(ast.UAdd,ast.USub)):
            return {k:v*(1 if isinstance(node.op,ast.UAdd) else -1) for k,v in visit(node.operand,depth+1).items()}
        if isinstance(node,ast.BinOp):
            left,right=visit(node.left,depth+1),visit(node.right,depth+1)
            if isinstance(node.op,ast.Add): return add(left,right)
            if isinstance(node.op,ast.Sub): return add(left,right,-1)
            if isinstance(node.op,ast.Mult): return multiply(left,right)
            if isinstance(node.op,ast.Div) and set(right)<={0} and right.get(0):
                return bounded({k:v/right[0] for k,v in left.items()})
            if isinstance(node.op,ast.Pow) and set(right)<={0}:
                power=right.get(0,Fraction(0))
                if power.denominator!=1 or not 0<=power<=8: raise ValueError("Power outside 0..8")
                result={0:Fraction(1)}
                for _ in range(int(power)): result=multiply(result,left)
                return result
        raise ValueError("Unsupported polynomial operation")
    try:
        result=visit(tree.body)
        return (variable if any(power>0 for power in result) else None),result
    except (ZeroDivisionError,OverflowError) as error:
        raise ValueError("Invalid polynomial arithmetic") from error
