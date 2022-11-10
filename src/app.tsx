import React, { useCallback, useEffect, useMemo, useReducer } from "react";

type QueryType = "all" | "any";
const initQueryType: QueryType = "all";

type Field = "title" | "body";
const initField = "title";

type Method =
    | { readonly type: "equal"; readonly value: string }
    | { readonly type: "match"; readonly value: string };
const allowedMethods: Record<Field, ReadonlyArray<Method["type"]>> = {
    title: ["equal"],
    body: ["equal", "match"],
};
const initMethods: Record<Method["type"], Method> = {
    equal: { type: "equal", value: "" },
    match: { type: "match", value: "" },
};
const initPredicateMethod = initMethods["equal"];

type FieldPredicate = {
    readonly type: "field";
    readonly field: Field;
    readonly method: Method;
};
type QueryPredicate = {
    readonly type: "query";
    readonly query: Query;
};
type Predicate = FieldPredicate | QueryPredicate;
const initFieldPredicate: Predicate = {
    type: "field",
    field: initField,
    method: initPredicateMethod,
};

type Query = {
    readonly type: QueryType;
    readonly predicates: readonly Predicate[];
};
const initQuery: Query = { type: initQueryType, predicates: [] };
const initQueryPredicate: Predicate = { type: "query", query: initQuery };

type QueryAction = Readonly<
    | { type: "updateType"; queryType: QueryType }
    | { type: "insertFirst"; predicateType: Predicate["type"] }
    | {
          type: "insertAfterNth";
          predicateType: Predicate["type"];
          index: number;
      }
    | { type: "removeNth"; index: number }
    | { type: "updateNthQuery"; index: number; action: QueryAction }
    | { type: "updateNthField"; index: number; field: Field }
    | { type: "updateNthMethod"; index: number; action: MethodAction }
>;
type QueryDispatch = React.Dispatch<QueryAction>;

type MethodAction = Readonly<
    | { type: "updateType"; methodType: Method["type"] }
    | { type: "updateTextValue"; value: string }
>;
type MethodDispatch = React.Dispatch<MethodAction>;

const methodReducer: React.Reducer<Method, MethodAction> = (method, action) => {
    switch (action.type) {
        case "updateType": {
            return initMethods[action.methodType];
        }
        case "updateTextValue":
            {
                switch (method.type) {
                    case "equal":
                    case "match":
                        return { ...method, value: action.value };
                }
            }
            break;
    }
    return method;
};

const queryReducer: React.Reducer<Query, QueryAction> = (query, action) => {
    switch (action.type) {
        case "updateType": {
            return { ...query, type: action.queryType };
        }
        case "insertFirst": {
            const toInsert =
                action.predicateType === "field"
                    ? initFieldPredicate
                    : initQueryPredicate;
            return { ...query, predicates: [toInsert, ...query.predicates] };
        }
        case "insertAfterNth": {
            const preds = query.predicates;
            const i = action.index;
            const predType = action.predicateType;

            const cursor = preds[i];
            let toInsert: Predicate;
            if (cursor.type === predType) {
                toInsert = cursor;
            } else if (predType === "field") {
                toInsert = initFieldPredicate;
            } else {
                toInsert = initQueryPredicate;
            }

            const lhs = preds.slice(0, i + 1);
            const rhs = preds.slice(i + 1);
            return {
                ...query,
                predicates: [...lhs, toInsert, ...rhs],
            };
        }
        case "removeNth": {
            const preds = query.predicates;
            const i = action.index;

            const lhs = preds.slice(0, i);
            const rhs = preds.slice(i + 1);
            return {
                ...query,
                predicates: [...lhs, ...rhs],
            };
        }
        case "updateNthQuery": {
            const preds = [...query.predicates];
            const nth = preds[action.index];
            if (nth.type !== "query") {
                throw new Error(`${action.index}th predicate is not a query`);
            }
            preds[action.index] = {
                type: "query",
                query: queryReducer(nth.query, action.action),
            };
            return {
                ...query,
                predicates: preds,
            };
        }
        case "updateNthField": {
            const preds = [...query.predicates];

            const nth = preds[action.index];
            if (nth.type !== "field") {
                throw new Error(
                    `${action.index}th predicate is not a field type`
                );
            }

            let method = nth.method;
            if (!allowedMethods[action.field].includes(method.type)) {
                method = initMethods[allowedMethods[action.field][0]];
            }

            preds[action.index] = {
                type: "field",
                field: action.field,
                method,
            };
            return {
                ...query,
                predicates: preds,
            };
        }
        case "updateNthMethod": {
            const preds = [...query.predicates];

            const nth = preds[action.index];
            if (nth.type !== "field") {
                throw new Error(
                    `${action.index}th predicate is not a field type`
                );
            }

            const method = methodReducer(nth.method, action.action);
            if (!allowedMethods[nth.field].includes(method.type)) {
                return query;
            }

            preds[action.index] = {
                ...nth,
                method,
            };

            return {
                ...query,
                predicates: preds,
            };
        }
    }
};

/**
 * サブクエリに対応する dispatch を作る
 *
 * ある Query に対応する dispatch があり，その Query の index 番目の Predicate が QueryPredicate であるとき，それに対応する dispatch を返す。
 */
const queryDispatchNth = (
    dispatch: QueryDispatch,
    index: number
): QueryDispatch => {
    const subDispatch: QueryDispatch = (action) => {
        dispatch({
            type: "updateNthQuery",
            index,
            action,
        });
    };
    return subDispatch;
};

function Query({
    query,
    dispatch,
    keyPrefix = "",
    remove,
}: {
    query: Query;
    dispatch: QueryDispatch;
    keyPrefix?: string;
} & (
    | { isRoot: true; remove?: never }
    | { isRoot: false; remove: () => void }
)) {
    const onTypeChange = useCallback<
        React.ChangeEventHandler<HTMLSelectElement>
    >(
        (e) => {
            const value = e.target.value;
            if (value === "all" || value === "any") {
                dispatch({ type: "updateType", queryType: value });
            }
        },
        [dispatch]
    );
    const typeSelect = (
        <select value={query.type} onChange={onTypeChange}>
            <option value="all">全て</option>
            <option value="any">どれか</option>
        </select>
    );

    const onInsertFieldFirstButtonClick = useCallback(() => {
        dispatch({ type: "insertFirst", predicateType: "field" });
    }, [dispatch]);
    const insertFieldFirstButton = (
        <button onClick={onInsertFieldFirstButtonClick}>F+</button>
    );

    const onInsertQueryFirstButtonClick = useCallback(() => {
        dispatch({ type: "insertFirst", predicateType: "query" });
    }, [dispatch]);
    const insertQueryFirstButton = (
        <button onClick={onInsertQueryFirstButtonClick}>Q+</button>
    );

    const removeButton = remove ? <button onClick={remove}>-</button> : null;

    return (
        <div>
            <p>
                次の{typeSelect}のルールに一致する項目: {insertFieldFirstButton}{" "}
                {insertQueryFirstButton} {removeButton}
            </p>
            <ul>
                {query.predicates.map((pred, i) => (
                    <Predicate predicate={pred} index={i} dispatch={dispatch} />
                ))}
            </ul>
        </div>
    );
}

function Predicate({
    predicate,
    index,
    dispatch,
}: {
    predicate: Predicate;
    index: number;
    dispatch: QueryDispatch;
}) {
    if (predicate.type === "field") {
        return (
            <FieldPredicate
                fieldPredicate={predicate}
                index={index}
                dispatch={dispatch}
            />
        );
    } else {
        return (
            <QueryPredicate
                queryPredicate={predicate}
                index={index}
                dispatch={dispatch}
            />
        );
    }
}

function QueryPredicate({
    queryPredicate,
    index,
    dispatch,
}: {
    queryPredicate: QueryPredicate;
    index: number;
    dispatch: QueryDispatch;
}) {
    const subDispatch = useMemo(
        () => queryDispatchNth(dispatch, index),
        [dispatch, index]
    );
    const remove = useCallback(() => {
        dispatch({ type: "removeNth", index });
    }, [index, dispatch]);

    return (
        <Query
            query={queryPredicate.query}
            dispatch={subDispatch}
            isRoot={false}
            remove={remove}
        />
    );
}

function FieldPredicate({
    fieldPredicate,
    index,
    dispatch,
}: {
    fieldPredicate: FieldPredicate;
    index: number;
    dispatch: QueryDispatch;
}) {
    const insertAfter = useCallback(() => {
        dispatch({ type: "insertAfterNth", index, predicateType: "field" });
    }, [index, dispatch]);

    const remove = useCallback(() => {
        dispatch({ type: "removeNth", index });
    }, [index, dispatch]);

    const updateField = useCallback(
        (field: Field) => {
            dispatch({
                type: "updateNthField",
                index,
                field,
            });
        },
        [index, dispatch]
    );

    const methodDispatch = useCallback(
        (action: MethodAction) => {
            dispatch({
                type: "updateNthMethod",
                index,
                action,
            });
        },
        [index, dispatch]
    );

    return (
        <Field
            field={fieldPredicate.field}
            method={fieldPredicate.method}
            insertAfter={insertAfter}
            remove={remove}
            updateField={updateField}
            methodDispatch={methodDispatch}
        />
    );
}

function Field({
    field,
    method,
    insertAfter,
    remove,
    updateField,
    methodDispatch,
}: {
    field: Field;
    method: Method;
    insertAfter: () => void;
    remove: () => void;
    updateField: (field: Field) => void;
    methodDispatch: MethodDispatch;
}) {
    const onFieldChange = useCallback<
        React.ChangeEventHandler<HTMLSelectElement>
    >(
        (e) => {
            const value = e.target.value as Field;
            updateField(value);
        },
        [updateField]
    );
    const fieldSelect = (
        <select value={field} onChange={onFieldChange}>
            <option value="title">タイトル</option>
            <option value="body">本文</option>
        </select>
    );

    const onMethodChange = useCallback<
        React.ChangeEventHandler<HTMLSelectElement>
    >(
        (e) => {
            const value = e.target.value as Method["type"];
            methodDispatch({ type: "updateType", methodType: value });
        },
        [methodDispatch]
    );
    const methodSelect = (
        <select value={method.type} onChange={onMethodChange}>
            {allowedMethods[field].map((methodType) => {
                switch (methodType) {
                    case "equal":
                        return (
                            <option key={methodType} value="equal">
                                一致
                            </option>
                        );
                    case "match":
                        return (
                            <option key={methodType} value="match">
                                正規表現とマッチ
                            </option>
                        );
                }
            })}
        </select>
    );
    const methodJoshiMap: Record<Method["type"], string> = {
        equal: "と",
        match: "の",
    };
    const methodJoshi = methodJoshiMap[method.type];

    const onMethodValueChange = useCallback<
        React.ChangeEventHandler<HTMLInputElement>
    >(
        (e) => {
            methodDispatch({ type: "updateTextValue", value: e.target.value });
        },
        [methodDispatch]
    );
    const methodValueInput = (
        <input
            type="text"
            value={method.value}
            onChange={onMethodValueChange}
        />
    );

    const insertAfterButton = <button onClick={insertAfter}>+</button>;
    const removeButton = <button onClick={remove}>-</button>;
    return (
        <p>
            <>
                {fieldSelect}が{methodValueInput}
                <>
                    {methodJoshi}
                    {methodSelect}
                </>
                <>
                    {insertAfterButton}
                    {removeButton}
                </>
            </>
        </p>
    );
}

export const App = () => {
    const [query, dispatch] = useReducer(queryReducer, initQuery);
    useEffect(() => {
        console.log(query);
    }, [query]);

    return (
        <main>
            <Query query={query} dispatch={dispatch} isRoot />
        </main>
    );
};
